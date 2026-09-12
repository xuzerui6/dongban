import assert from 'node:assert/strict'
import { getHeartRateZone } from '../src/lib/heartRate'
import { calculateWorkoutXP } from '../src/lib/rewards'
import { parseHeartRateMeasurement } from '../src/services/bleHeartRate'
import type { WorkoutSession } from '../src/types'
import { createCorrectionGateState, decideCorrectionCue, detectPoseIssues, medianLandmarks } from '../src/lib/poseFeedback'
import { abortMessage, helloMessage, listenMessage, mapXiaozhiEmotion } from '../src/lib/xiaozhiProtocol'
import { emptyCorrectionCounts, emptyFormBreakdown, migrateWorkoutSession } from '../src/lib/sessionMigration'
import { activationHmac, createDeviceIdentity, decryptIdentity, encryptIdentity } from '../server/xiaozhi/identity'
import { fetchOta, pollActivation } from '../server/xiaozhi/ota'

const uint8 = new DataView(Uint8Array.from([0x00, 147]).buffer)
const uint16 = new DataView(Uint8Array.from([0x01, 0x34, 0x01]).buffer)
assert.equal(parseHeartRateMeasurement(uint8), 147, 'flags bit0=0 应按 uint8 解析')
assert.equal(parseHeartRateMeasurement(uint16), 308, 'flags bit0=1 应按 little-endian uint16 解析')

assert.equal(getHeartRateZone(110, 20), 1)
assert.equal(getHeartRateZone(120, 20), 2)
assert.equal(getHeartRateZone(140, 20), 3)
assert.equal(getHeartRateZone(160, 20), 4)
assert.equal(getHeartRateZone(180, 20), 5)

const session: WorkoutSession = {
  id: 'test', exerciseType: 'squat', startTime: new Date().toISOString(), endTime: new Date().toISOString(), durationSeconds: 360,
  reps: 20, targetReps: 20, formScore: 92, perfectReps: 12, feedback: '', phase: 'standing',
  currentBpm: 150, averageBpm: 145, maxBpm: 170, heartRateSource: 'ble',
  zone1Seconds: 0, zone2Seconds: 30, zone3Seconds: 300, zone4Seconds: 30, zone5Seconds: 0,
  xpEarned: 0, unlocked: [],
  formBreakdown: emptyFormBreakdown(), correctionCounts: emptyCorrectionCounts(), visionInsights: [], conversationTurnCount: 0,
}
assert.equal(calculateWorkoutXP(session), 122, 'XP 应为 round(20*3*1.2+50)')

const identity = createDeviceIdentity()
const encrypted = encryptIdentity(identity)
assert.notEqual(encrypted, JSON.stringify(identity), 'Cookie 中不能出现身份明文')
assert.deepEqual(decryptIdentity(encrypted), identity, 'AES-GCM Cookie 应可无损解密')
assert.match(activationHmac(identity, 'challenge'), /^[a-f0-9]{64}$/)
assert.equal(decryptIdentity(`${encrypted}tampered`), null, '被篡改的 Cookie 必须拒绝')

const originalFetch = globalThis.fetch
let otaHeaders: Headers | null = null
globalThis.fetch = async (_input, init) => {
  otaHeaders = new Headers(init?.headers)
  return new Response(JSON.stringify({ websocket: { url: 'wss://mock.local', token: 'secret' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
assert.equal((await fetchOta(identity)).websocket?.url, 'wss://mock.local')
assert.equal(otaHeaders?.get('Activation-Version'), '2.1.2')
identity.activation = { code: '123456', challenge: 'challenge', message: '', expiresAt: Date.now() + 1_000 }
globalThis.fetch = async (_input, init) => {
  otaHeaders = new Headers(init?.headers)
  return new Response('', { status: 202 })
}
assert.equal(await pollActivation(identity), 'waiting')
assert.equal(otaHeaders?.get('Activation-Version'), '2')
globalThis.fetch = originalFetch

assert.deepEqual(helloMessage().audio_params, { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 })
assert.deepEqual(listenMessage('start'), { type: 'listen', state: 'start', mode: 'auto' })
assert.deepEqual(abortMessage(), { type: 'abort', reason: 'user_interrupt' })
assert.equal(mapXiaozhiEmotion('excited'), 'celebrating')

const landmarkFrames = [1, 9, 5, 3, 7].map(x => Array.from({ length: 29 }, () => ({ x, y: .5, z: 0, visibility: .9 })))
assert.equal(medianLandmarks(landmarkFrames)?.[0].x, 5, '五帧中值应过滤跳点')
const feedback = detectPoseIssues({ kneeAngle: 110, depthScore: 60, stabilityScore: 55, trunkScore: 90, symmetryScore: 92, formScore: 70, confidence: .9 }, 'bottom', true)
assert.equal(feedback.status, 'adjust')
assert.deepEqual(feedback.issues, ['insufficient_depth', 'knee_instability'])
const gate = createCorrectionGateState()
assert.equal(decideCorrectionCue(['knee_instability'], 20_000, gate), null, '同类问题第一次出现不应立刻播报')
assert.equal(decideCorrectionCue(['knee_instability'], 21_000, gate)?.issue, 'knee_instability', '连续两次才播报')
assert.equal(decideCorrectionCue([], 22_000, gate)?.improved, true, '改善后应优先确认具体进步')

const legacy = { ...session } as WorkoutSession
delete (legacy as Partial<WorkoutSession>).formBreakdown
delete (legacy as Partial<WorkoutSession>).correctionCounts
delete (legacy as Partial<WorkoutSession>).visionInsights
delete (legacy as Partial<WorkoutSession>).conversationTurnCount
const migrated = migrateWorkoutSession(legacy)
assert.deepEqual(migrated.formBreakdown, emptyFormBreakdown())
assert.equal(migrated.conversationTurnCount, 0)

console.log('Core tests passed: BLE/HR/XP, identity crypto/OTA activation, Xiaozhi protocol, pose smoothing/corrections, history migration')
