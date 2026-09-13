import type { Request, Response } from 'express'
import { getIdentityMode, readIdentity, writeIdentity } from '../../server/xiaozhi/identity.js'
import { fetchOta, pollActivation } from '../../server/xiaozhi/ota.js'

export const maxDuration = 30

export default async function handler(request: Request, response: Response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
  response.setHeader('Cache-Control', 'no-store')
  const mode = getIdentityMode()
  if (mode === 'shared') return response.status(409).json({ error: '共享语音模式无需访客激活', mode })
  if (mode === 'disabled') return response.status(503).json({ error: '语音服务暂时维护', mode })
  const identity = readIdentity(request)
  if (!identity) return response.status(401).json({ error: '设备身份不存在，请重新初始化' })
  try {
    const status = await pollActivation(identity)
    if (status === 'waiting') return response.status(202).json({ status: 'waiting', mode, code: identity.activation?.code })
    const ota = await fetchOta(identity)
    if (!ota.websocket?.url || !ota.websocket.token) throw new Error('激活完成，但 OTA 未返回连接配置')
    identity.activated = true
    delete identity.activation
    writeIdentity(response, identity)
    return response.status(200).json({ status: 'ready', mode })
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : '激活轮询失败' })
  }
}
