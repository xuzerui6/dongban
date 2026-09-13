import assert from 'node:assert/strict'
import deviceHandler from '../api/xiaozhi/device'
import activateHandler from '../api/xiaozhi/activate'
import { createDeviceIdentity, encodeSharedIdentity, PUBLIC_SESSION_COOKIE } from '../server/xiaozhi/identity'

type MockResponse = {
  statusCode: number
  body: unknown
  headers: Map<string, unknown>
  status: (code: number) => MockResponse
  json: (body: unknown) => MockResponse
  setHeader: (name: string, value: unknown) => void
  getHeader: (name: string) => unknown
}

const response = (): MockResponse => {
  const result: MockResponse = {
    statusCode: 200,
    body: null,
    headers: new Map(),
    status(code) { result.statusCode = code; return result },
    json(body) { result.body = body; return result },
    setHeader(name, value) { result.headers.set(name.toLowerCase(), value) },
    getHeader(name) { return result.headers.get(name.toLowerCase()) },
  }
  return result
}

const originalFetch = globalThis.fetch
const originalMode = process.env.XIAOZHI_IDENTITY_MODE
const originalShared = process.env.XIAOZHI_SHARED_IDENTITY_B64
const originalSecret = process.env.XIAOZHI_COOKIE_SECRET

try {
  const identity = { ...createDeviceIdentity(), activated: true }
  process.env.XIAOZHI_COOKIE_SECRET = 'test-cookie-secret-with-more-than-32-characters'
  process.env.XIAOZHI_IDENTITY_MODE = 'shared'
  process.env.XIAOZHI_SHARED_IDENTITY_B64 = encodeSharedIdentity(identity)
  globalThis.fetch = async () => new Response(JSON.stringify({ websocket: { url: 'wss://mock.local', token: 'secret' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  const ready = response()
  await deviceHandler({ method: 'POST', headers: {} } as never, ready as never)
  assert.equal(ready.statusCode, 200)
  assert.deepEqual(ready.body, { status: 'ready', mode: 'shared' })
  assert.equal(ready.headers.get('cache-control'), 'no-store')
  const cookies = ready.headers.get('set-cookie') as string[]
  assert.ok(cookies.some(cookie => cookie.startsWith(`${PUBLIC_SESSION_COOKIE}=`)))
  assert.ok(cookies.some(cookie => cookie.includes('motion_buddy_xz_device=') && cookie.includes('Max-Age=0')))

  const activate = response()
  await activateHandler({ method: 'POST', headers: {} } as never, activate as never)
  assert.equal(activate.statusCode, 409)
  assert.equal((activate.body as { mode: string }).mode, 'shared')

  process.env.XIAOZHI_SHARED_IDENTITY_B64 = 'invalid'
  const broken = response()
  await deviceHandler({ method: 'POST', headers: {} } as never, broken as never)
  assert.equal(broken.statusCode, 503)
  assert.deepEqual(broken.body, { error: '语音服务暂时维护', mode: 'shared' })
  assert.equal(JSON.stringify(broken.body).includes('code'), false, '共享配置异常时不能泄露激活码')

  process.env.XIAOZHI_IDENTITY_MODE = 'disabled'
  const disabled = response()
  await deviceHandler({ method: 'POST', headers: {} } as never, disabled as never)
  assert.equal(disabled.statusCode, 503)
  assert.deepEqual(disabled.body, { error: '语音服务暂时维护', mode: 'disabled' })
} finally {
  globalThis.fetch = originalFetch
  if (originalMode === undefined) delete process.env.XIAOZHI_IDENTITY_MODE
  else process.env.XIAOZHI_IDENTITY_MODE = originalMode
  if (originalShared === undefined) delete process.env.XIAOZHI_SHARED_IDENTITY_B64
  else process.env.XIAOZHI_SHARED_IDENTITY_B64 = originalShared
  if (originalSecret === undefined) delete process.env.XIAOZHI_COOKIE_SECRET
  else process.env.XIAOZHI_COOKIE_SECRET = originalSecret
}

console.log('Shared Xiaozhi access passed: ready bootstrap, short session cookie, no visitor activation, disabled mode')
