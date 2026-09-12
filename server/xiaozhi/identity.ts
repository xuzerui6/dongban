import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const IDENTITY_COOKIE = 'motion_buddy_xz_device'

export interface VirtualDeviceIdentity {
  deviceId: string
  clientId: string
  serialNumber: string
  hmacKey: string
  activated: boolean
  activation?: { code: string; challenge: string; message: string; expiresAt: number }
}

const secretKey = () => {
  const raw = process.env.XIAOZHI_COOKIE_SECRET?.trim()
  if (!raw && process.env.NODE_ENV === 'production') throw new Error('缺少 XIAOZHI_COOKIE_SECRET')
  return createHash('sha256').update(raw || 'motion-buddy-local-development-secret').digest()
}

const mac = () => {
  const bytes = randomBytes(6)
  bytes[0] = (bytes[0] | 0x02) & 0xfe
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join(':')
}

export function createDeviceIdentity(): VirtualDeviceIdentity {
  return {
    deviceId: mac(), clientId: randomUUID(), serialNumber: randomBytes(16).toString('hex').toUpperCase(),
    hmacKey: randomBytes(32).toString('hex'), activated: false,
  }
}

export function activationHmac(identity: VirtualDeviceIdentity, challenge: string): string {
  return createHmac('sha256', identity.hmacKey).update(challenge).digest('hex')
}

export function encryptIdentity(identity: VirtualDeviceIdentity): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(identity), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.')
}

export function decryptIdentity(value: string | undefined): VirtualDeviceIdentity | null {
  if (!value) return null
  try {
    const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64url'))
    if (!iv || !tag || !encrypted) return null
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as VirtualDeviceIdentity
  } catch {
    return null
  }
}

export function cookieValue(request: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  const cookies = request.headers.cookie || ''
  return cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function readIdentity(request: Pick<IncomingMessage, 'headers'>): VirtualDeviceIdentity | null {
  return decryptIdentity(cookieValue(request, IDENTITY_COOKIE))
}

export function writeIdentity(response: Pick<ServerResponse, 'setHeader'>, identity: VirtualDeviceIdentity): void {
  response.setHeader('Set-Cookie', `${IDENTITY_COOKIE}=${encryptIdentity(identity)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`)
}
