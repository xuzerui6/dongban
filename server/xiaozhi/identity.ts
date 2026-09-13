import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const IDENTITY_COOKIE = 'motion_buddy_xz_device'
export const PUBLIC_SESSION_COOKIE = 'motion_buddy_xz_session'
export const PUBLIC_SESSION_TTL_MS = 2 * 60 * 60 * 1_000

export type XiaozhiIdentityMode = 'personal' | 'shared' | 'disabled'

export interface VirtualDeviceIdentity {
  deviceId: string
  clientId: string
  serialNumber: string
  hmacKey: string
  activated: boolean
  activation?: { code: string; challenge: string; message: string; expiresAt: number }
}

type CookieResponse = Pick<ServerResponse, 'getHeader' | 'setHeader'>

const secretKey = (override?: string) => {
  const raw = override?.trim() || process.env.XIAOZHI_COOKIE_SECRET?.trim()
  if (!raw && process.env.NODE_ENV === 'production') throw new Error('缺少 XIAOZHI_COOKIE_SECRET')
  return createHash('sha256').update(raw || 'motion-buddy-local-development-secret').digest()
}

const mac = () => {
  const bytes = randomBytes(6)
  bytes[0] = (bytes[0] | 0x02) & 0xfe
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join(':')
}

const isIdentity = (value: unknown, requireActivated = false): value is VirtualDeviceIdentity => {
  if (!value || typeof value !== 'object') return false
  const identity = value as Partial<VirtualDeviceIdentity>
  return /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i.test(identity.deviceId || '')
    && typeof identity.clientId === 'string' && identity.clientId.length >= 16
    && typeof identity.serialNumber === 'string' && identity.serialNumber.length >= 16
    && /^[0-9a-f]{64}$/i.test(identity.hmacKey || '')
    && typeof identity.activated === 'boolean'
    && (!requireActivated || identity.activated)
}

const appendCookies = (response: CookieResponse, cookies: string[]) => {
  const current = response.getHeader('Set-Cookie')
  const existing = Array.isArray(current) ? current.map(String) : current ? [String(current)] : []
  response.setHeader('Set-Cookie', [...existing, ...cookies])
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
    const result = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as unknown
    return isIdentity(result) ? result : null
  } catch {
    return null
  }
}

export function encodeSharedIdentity(identity: VirtualDeviceIdentity): string {
  if (!isIdentity(identity, true)) throw new Error('共享设备必须已经完成激活')
  const safeIdentity: VirtualDeviceIdentity = { ...identity, activated: true }
  delete safeIdentity.activation
  return Buffer.from(JSON.stringify(safeIdentity), 'utf8').toString('base64url')
}

export function decodeSharedIdentity(value: string | undefined): VirtualDeviceIdentity | null {
  if (!value || value.length > 4_096) return null
  try {
    const result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    return isIdentity(result, true) ? result : null
  } catch {
    return null
  }
}

export function getIdentityMode(value = process.env.XIAOZHI_IDENTITY_MODE): XiaozhiIdentityMode {
  if (!value || value === 'personal') return 'personal'
  return value === 'shared' ? 'shared' : 'disabled'
}

export function readSharedIdentity(value = process.env.XIAOZHI_SHARED_IDENTITY_B64): VirtualDeviceIdentity | null {
  return decodeSharedIdentity(value)
}

export function cookieValue(request: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  const cookies = request.headers.cookie || ''
  return cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function readIdentity(request: Pick<IncomingMessage, 'headers'>): VirtualDeviceIdentity | null {
  return decryptIdentity(cookieValue(request, IDENTITY_COOKIE))
}

export function resolveRequestIdentity(
  request: Pick<IncomingMessage, 'headers'>,
  mode = getIdentityMode(),
  sharedValue = process.env.XIAOZHI_SHARED_IDENTITY_B64,
): VirtualDeviceIdentity | null {
  if (mode === 'disabled') return null
  return mode === 'shared' ? readSharedIdentity(sharedValue) : readIdentity(request)
}

export function writeIdentity(response: CookieResponse, identity: VirtualDeviceIdentity): void {
  appendCookies(response, [`${IDENTITY_COOKIE}=${encryptIdentity(identity)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`])
}

export function createPublicSessionToken(
  now = Date.now(),
  ttlMs = PUBLIC_SESSION_TTL_MS,
  secretOverride?: string,
): string {
  const payload = Buffer.from(JSON.stringify({ id: randomUUID(), expiresAt: now + ttlMs }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secretKey(secretOverride)).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyPublicSessionToken(value: string | undefined, now = Date.now(), secretOverride?: string): boolean {
  if (!value) return false
  try {
    const [payload, signature] = value.split('.')
    if (!payload || !signature) return false
    const expected = createHmac('sha256', secretKey(secretOverride)).update(payload).digest()
    const received = Buffer.from(signature, 'base64url')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: unknown; expiresAt?: unknown }
    return typeof parsed.id === 'string' && parsed.id.length >= 16
      && typeof parsed.expiresAt === 'number' && parsed.expiresAt > now
      && parsed.expiresAt <= now + PUBLIC_SESSION_TTL_MS + 60_000
  } catch {
    return false
  }
}

export function hasPublicSession(request: Pick<IncomingMessage, 'headers'>, now = Date.now()): boolean {
  return verifyPublicSessionToken(cookieValue(request, PUBLIC_SESSION_COOKIE), now)
}

export function writePublicSession(response: CookieResponse, token = createPublicSessionToken()): void {
  appendCookies(response, [
    `${PUBLIC_SESSION_COOKIE}=${token}; Path=/; Max-Age=${PUBLIC_SESSION_TTL_MS / 1_000}; HttpOnly; Secure; SameSite=Lax`,
    `${IDENTITY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  ])
}

export function isAllowedOrigin(
  origin: string | undefined,
  configured = process.env.XIAOZHI_ALLOWED_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (!origin) return false
  const allowed = new Set((configured || 'https://dongban.xzrcloud.xyz,https://dongban.vercel.app')
    .split(',').map(value => value.trim()).filter(Boolean))
  if (nodeEnv !== 'production') {
    allowed.add('http://localhost:4173')
    allowed.add('http://127.0.0.1:4173')
    allowed.add('http://localhost:5173')
    allowed.add('http://127.0.0.1:5173')
  }
  return allowed.has(origin)
}
