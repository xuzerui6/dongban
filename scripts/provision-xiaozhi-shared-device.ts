import { setTimeout as delay } from 'node:timers/promises'
import { createDeviceIdentity, encodeSharedIdentity } from '../server/xiaozhi/identity.js'
import { fetchOta, pollActivation } from '../server/xiaozhi/ota.js'

const identity = createDeviceIdentity()

console.log('\n正在创建“动伴”公共演示设备…')
const firstOta = await fetchOta(identity)

if (firstOta.activation?.code && firstOta.activation.challenge) {
  identity.activation = {
    code: firstOta.activation.code,
    challenge: firstOta.activation.challenge,
    message: firstOta.activation.message || '请在小智控制台绑定设备',
    expiresAt: Date.now() + Math.min(300_000, firstOta.activation.timeout_ms || 300_000),
  }
  console.log(`\n激活码：${identity.activation.code}`)
  console.log('请打开 https://xiaozhi.me，将此设备绑定到“动伴”智能体。脚本会自动等待，最长 5 分钟。\n')

  let activated = false
  while (Date.now() < identity.activation.expiresAt) {
    const status = await pollActivation(identity)
    if (status === 'ready') {
      activated = true
      break
    }
    await delay(3_000)
  }
  if (!activated) throw new Error('激活码已过期，请重新运行 pnpm provision:xiaozhi')
}

const ready = await fetchOta(identity)
if (ready.activation || !ready.websocket?.url || !ready.websocket.token) throw new Error('设备尚未绑定到智能体')
identity.activated = true
delete identity.activation

console.log('\n共享设备已激活。将下面整行作为 Vercel 的 XIAOZHI_SHARED_IDENTITY_B64：\n')
console.log(encodeSharedIdentity(identity))
console.log('\n此值等同服务端凭据，请勿提交到 Git、截图或发给他人。\n')
