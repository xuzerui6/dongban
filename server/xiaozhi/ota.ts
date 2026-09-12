import type { VirtualDeviceIdentity } from './identity.js'
import { activationHmac } from './identity.js'

const OTA_URL = (process.env.XIAOZHI_OTA_URL || 'https://api.tenclass.net/xiaozhi/ota/').replace(/\/+$/, '')

export interface OtaResponse {
  websocket?: { url?: string; token?: string }
  activation?: { code?: string; challenge?: string; message?: string; timeout_ms?: number }
}

const headers = (identity: VirtualDeviceIdentity, activationVersion = '2.1.2') => ({
  'Device-Id': identity.deviceId,
  'Client-Id': identity.clientId,
  'Content-Type': 'application/json',
  'User-Agent': 'web/motion-buddy-1.0.0',
  'Accept-Language': 'zh-CN',
  'Activation-Version': activationVersion,
})

export async function fetchOta(identity: VirtualDeviceIdentity): Promise<OtaResponse> {
  const response = await fetch(`${OTA_URL}/`, {
    method: 'POST', headers: headers(identity), signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      application: { version: '2.1.2', elf_sha256: identity.hmacKey },
      board: { type: 'web', name: 'motion-buddy', ip: '0.0.0.0', mac: identity.deviceId },
    }),
  })
  if (!response.ok) throw new Error(`小智 OTA 返回 HTTP ${response.status}`)
  return response.json() as Promise<OtaResponse>
}

export async function pollActivation(identity: VirtualDeviceIdentity): Promise<'ready' | 'waiting'> {
  const activation = identity.activation
  if (!activation?.challenge) throw new Error('激活挑战已失效，请重新获取激活码')
  const response = await fetch(`${OTA_URL}/activate`, {
    method: 'POST', headers: headers(identity, '2'), signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ Payload: {
      algorithm: 'hmac-sha256', serial_number: identity.serialNumber,
      challenge: activation.challenge, hmac: activationHmac(identity, activation.challenge),
    } }),
  })
  if (response.status === 200) return 'ready'
  if (response.status === 202) return 'waiting'
  throw new Error(`小智激活返回 HTTP ${response.status}`)
}
