import type { Request, Response } from 'express'
import {
  createDeviceIdentity, getIdentityMode, readIdentity, readSharedIdentity, writeIdentity, writePublicSession,
} from '../../server/xiaozhi/identity.js'
import { fetchOta } from '../../server/xiaozhi/ota.js'

export const maxDuration = 30

export default async function handler(request: Request, response: Response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  response.setHeader('Cache-Control', 'no-store')
  const mode = getIdentityMode()
  if (mode === 'disabled') return response.status(503).json({ error: '语音服务暂时维护', mode })
  try {
    if (mode === 'shared') {
      const identity = readSharedIdentity()
      if (!identity) return response.status(503).json({ error: '语音服务暂时维护', mode })
      const ota = await fetchOta(identity)
      if (ota.activation || !ota.websocket?.url || !ota.websocket.token) {
        return response.status(503).json({ error: '语音服务暂时维护', mode })
      }
      writePublicSession(response)
      return response.status(200).json({ status: 'ready', mode })
    }

    const identity = readIdentity(request) || createDeviceIdentity()
    const ota = await fetchOta(identity)
    if (ota.activation?.code && ota.activation.challenge) {
      identity.activated = false
      identity.activation = {
        code: ota.activation.code, challenge: ota.activation.challenge,
        message: ota.activation.message || '请在小智控制台输入激活码',
        expiresAt: Date.now() + Math.min(300_000, ota.activation.timeout_ms || 300_000),
      }
      writeIdentity(response, identity)
      return response.status(200).json({ status: 'activating', mode, code: identity.activation.code, message: identity.activation.message, expiresAt: identity.activation.expiresAt })
    }
    if (!ota.websocket?.url || !ota.websocket.token) throw new Error('OTA 未返回 WebSocket 配置')
    identity.activated = true
    delete identity.activation
    writeIdentity(response, identity)
    return response.status(200).json({ status: 'ready', mode })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : '小智设备初始化失败' })
  }
}
