import type { Request, Response } from 'express'
import { createDeviceIdentity, readIdentity, writeIdentity } from '../../server/xiaozhi/identity.js'
import { fetchOta } from '../../server/xiaozhi/ota.js'

export const maxDuration = 30

export default async function handler(request: Request, response: Response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  try {
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
      return response.status(200).json({ status: 'activating', code: identity.activation.code, message: identity.activation.message, expiresAt: identity.activation.expiresAt })
    }
    if (!ota.websocket?.url || !ota.websocket.token) throw new Error('OTA 未返回 WebSocket 配置')
    identity.activated = true
    delete identity.activation
    writeIdentity(response, identity)
    return response.status(200).json({ status: 'ready' })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : '小智设备初始化失败' })
  }
}
