import { createServer } from 'node:http'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import {
  getIdentityMode, hasPublicSession, isAllowedOrigin, resolveRequestIdentity, type VirtualDeviceIdentity,
} from '../../server/xiaozhi/identity.js'
import { fetchOta } from '../../server/xiaozhi/ota.js'

export const maxDuration = 300

type VisionConfig = { url: string; token?: string }
const json = (value: unknown) => JSON.stringify(value)

class VisionError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
  }
}

async function explainFrame(config: VisionConfig, identity: VirtualDeviceIdentity, dataUrl: string, question: string) {
  const bytes = Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64')
  if (!bytes.length || bytes.length > 1_500_000) throw new VisionError('关键帧大小无效')
  const form = new FormData()
  form.append('question', question)
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'camera.jpg')
  const response = await fetch(config.url, {
    method: 'POST', signal: AbortSignal.timeout(15_000), body: form,
    headers: {
      'Device-Id': identity.deviceId, 'Client-Id': identity.clientId,
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
  })
  const body = await response.text()
  if (!response.ok) throw new VisionError(`视觉复核返回 HTTP ${response.status}`, response.status === 429 || response.status >= 500)
  try { return JSON.parse(body) as unknown } catch { return { success: true, text: body } }
}

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', async (browser, request) => {
  const mode = getIdentityMode()
  if (mode === 'disabled') return browser.close(4403, 'voice service disabled')
  if (mode === 'shared') {
    if (!isAllowedOrigin(request.headers.origin)) return browser.close(4403, 'origin not allowed')
    if (!hasPublicSession(request)) return browser.close(4401, 'public session missing or expired')
  }
  const identity = resolveRequestIdentity(request, mode)
  if (!identity) return browser.close(4401, 'device identity missing')
  let upstream: WebSocket | null = null
  let vision: VisionConfig | null = null
  const pending: Array<{ data: Buffer; binary: boolean }> = []

  try {
    const ota = await fetchOta(identity)
    if (!ota.websocket?.url || !ota.websocket.token || ota.activation) return browser.close(4401, 'device activation required')
    upstream = new WebSocket(ota.websocket.url, {
      headers: {
        Authorization: `Bearer ${ota.websocket.token}`, 'Protocol-Version': '1',
        'Device-Id': identity.deviceId, 'Client-Id': identity.clientId,
      },
    })
    upstream.on('open', () => {
      if (browser.readyState === WebSocket.OPEN) browser.send(json({ bridge: 'ready' }))
      for (const item of pending.splice(0)) upstream?.send(item.data, { binary: item.binary })
    })
    upstream.on('message', (data, isBinary) => {
      if (browser.readyState !== WebSocket.OPEN) return
      if (isBinary) return browser.send(data, { binary: true })
      let text = data.toString()
      try {
        const message = JSON.parse(text) as { type?: string; payload?: { method?: string; params?: { capabilities?: { vision?: VisionConfig } } } }
        const capability = message.type === 'mcp' && message.payload?.method === 'initialize' ? message.payload.params?.capabilities?.vision : undefined
        if (capability?.url) {
          vision = capability
          delete message.payload?.params?.capabilities?.vision
          browser.send(json({ bridge: 'vision_available' }))
          text = json(message)
        }
      } catch { /* 普通文本消息 */ }
      browser.send(text)
    })
    upstream.on('close', (code, reason) => {
      if (browser.readyState === WebSocket.OPEN) browser.close(code || 1012, reason.toString().slice(0, 120))
    })
    upstream.on('error', () => {
      if (browser.readyState === WebSocket.OPEN) browser.send(json({ bridge: 'error', message: '小智上游连接失败' }))
    })
  } catch (error) {
    browser.send(json({ bridge: 'error', message: error instanceof Error ? error.message : '小智连接失败' }))
    return browser.close(1011, 'upstream unavailable')
  }

  browser.on('message', async (data, isBinary) => {
    if (!isBinary) {
      try {
        const message = JSON.parse(data.toString()) as {
          bridge?: string; image?: string; question?: string; requestId?: string
          mcpId?: string | number; sessionId?: string
        }
        if (message.bridge === 'ping') return browser.send(json({ bridge: 'pong' }))
        if (message.bridge === 'vision_frame') {
          if (!vision || !message.image) {
            const error = '视觉服务未就绪或没有关键帧'
            return browser.send(json({
              bridge: 'vision_result', requestId: message.requestId, mcpId: message.mcpId,
              sessionId: message.sessionId, error, retryable: false,
            }))
          }
          try {
            const result = await explainFrame(vision, identity, message.image, message.question || '请简短描述动作中最值得调整的一点，不做医疗诊断。')
            return browser.send(json({
              bridge: 'vision_result', requestId: message.requestId, mcpId: message.mcpId,
              sessionId: message.sessionId, result,
            }))
          } catch (error) {
            const detail = error instanceof Error ? error.message : '视觉复核失败'
            return browser.send(json({
              bridge: 'vision_result', requestId: message.requestId, mcpId: message.mcpId,
              sessionId: message.sessionId, error: detail, retryable: error instanceof VisionError && error.retryable,
            }))
          }
        }
      } catch { /* 原生协议文本，继续转发 */ }
    }
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: isBinary })
    else pending.push({ data: bytes, binary: isBinary })
  })
  browser.on('close', () => upstream?.close(1000, 'browser closed'))
})

export default server
