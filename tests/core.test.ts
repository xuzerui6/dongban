import assert from 'node:assert/strict'
import { getHeartRateZone } from '../src/lib/heartRate'
import { applyWorkout, calculateWorkoutXp, evaluateOutfitUnlocks, progressFromTotalXp, requiredXp } from '../src/lib/rewards'
import { parseHeartRateMeasurement } from '../src/services/bleHeartRate'
import type { AppState, Equipment, WorkoutSession } from '../src/types'
import { createCorrectionGateState, decideCorrectionCue, detectPoseIssues, medianLandmarks } from '../src/lib/poseFeedback'
import { abortMessage, helloMessage, listenMessage, mapXiaozhiEmotion, mcpNotification, mcpTextResult } from '../src/lib/xiaozhiProtocol'
import { matchesWakeWord, WakeWordWindow } from '../src/lib/wakeWord'
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
assert.equal(calculateWorkoutXp(session), 140, '20 次且评分 90+ 应获得 50+40+50 XP')
assert.equal(calculateWorkoutXp({ reps: 200, formScore: 100 }), 300, '单次训练基础 XP 必须封顶 300')
assert.equal(requiredXp(1), 300)
assert.equal(requiredXp(5), 700)
assert.deepEqual(progressFromTotalXp(750), { level: 3, xp: 50 }, '累计 XP 应支持连续升级并保留余量')

const rewardEquipment = (id: string, slot: Equipment['slot']): Equipment => ({ id, slot, name: id, rarity: 'N', image: '', accent: '', condition: '', owned: false })
const outfitRewardState: AppState = {
  avatarGender: 'male', activeOutfit: 'default', nickname: 'test', age: 24, level: 1, xp: 0, totalXp: 0, streakDays: 0,
  workouts: 2, completedWorkoutCount: 2, highScoreWorkoutCount: 2,
  totalSquats: 90,
  equipment: [rewardEquipment('penguin_hood', 'head'), rewardEquipment('comet_running_shoes', 'shoes'), rewardEquipment('sakura_gloves', 'gloves')],
  equipped: {}, history: [], dailyMissionProgress: { date: '', squatReps: 0, zone3Seconds: 0, hasHighScoreWorkout: false },
  unlockedOutfits: { default: true, penguin: false, sakura: false, sunset_sakura: false },
  seenOutfits: ['default'], newlyUnlockedOutfits: [],
}
const outfitReward = applyWorkout(outfitRewardState, session)
assert.deepEqual(outfitReward.session.unlockedOutfits, ['penguin', 'sakura'])
assert.equal(outfitReward.next.unlockedOutfits.sakura, true, '90+ 动作评分应解锁樱花套装')
assert.equal(outfitReward.session.baseXpEarned, 140)
assert.equal(outfitReward.session.missionXpEarned, 200)
const duplicateReward = applyWorkout(outfitReward.next, session)
assert.equal(duplicateReward.next.totalXp, outfitReward.next.totalXp, '同一训练 session 不能重复领取 XP')
assert.equal(duplicateReward.next.history.length, 1, '同一训练 session 不能重复写入历史')
const noRepeatUnlock = applyWorkout(outfitReward.next, { ...session, id: 'next-session', formScore: 70 }, false)
assert.deepEqual(noRepeatUnlock.session.unlockedOutfits, [], '已经解锁的套装不能重复触发新解锁')

const sunsetReward = applyWorkout({ ...outfitRewardState, workouts: 4, completedWorkoutCount: 4, highScoreWorkoutCount: 0, totalXp: 900 }, { ...session, id: 'sunset', formScore: 80 }, false)
assert.deepEqual(sunsetReward.session.unlockedOutfits, ['penguin', 'sunset_sakura'])
assert.equal(sunsetReward.next.unlockedOutfits.sunset_sakura, true, '完成 5 次训练应解锁落日樱花套装')
assert.deepEqual(evaluateOutfitUnlocks({ ...outfitRewardState, level: 5 }).newlyUnlockedOutfits, ['sunset_sakura'], 'Lv.5 应直接解锁落日樱花套装')

const multiLevelReward = applyWorkout({ ...outfitRewardState, xp: 250, totalXp: 250, completedWorkoutCount: 0, workouts: 0, highScoreWorkoutCount: 0 }, { ...session, id: 'multi', reps: 200 })
assert.equal(multiLevelReward.session.xpEarned, 500)
assert.deepEqual({ level: multiLevelReward.next.level, xp: multiLevelReward.next.xp }, { level: 3, xp: 50 })

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
assert.deepEqual(listenMessage('detect', 'session-1'), { type: 'listen', state: 'detect', text: '你好动伴', session_id: 'session-1' })
assert.equal(abortMessage('user_interrupt', 'session-1').session_id, 'session-1')
assert.equal(mcpNotification('notifications/workout_progress', { reps: 3 }, 'session-1').session_id, 'session-1')
const toolResult = mcpTextResult(9, { reps: 3 }, 'session-1')
assert.equal(toolResult.session_id, 'session-1')
assert.deepEqual(toolResult.payload, {
  jsonrpc: '2.0', id: 9,
  result: { content: [{ type: 'text', text: '{"reps":3}' }], isError: false },
})
assert.equal(mapXiaozhiEmotion('excited'), 'celebrating')

assert.equal(matchesWakeWord('你好东伴'), true)
assert.equal(matchesWakeWord('教练'), true)
assert.equal(matchesWakeWord('dongban'), true)
assert.equal(matchesWakeWord('今天动作标准吗'), false)
const splitWake = new WakeWordWindow()
assert.equal(splitWake.push('你好', true, 1_000).matched, false)
assert.equal(splitWake.push('动伴', true, 2_000).matched, true, '拆开的 final 结果应合并唤醒')
assert.equal(splitWake.push('动伴', true, 3_000).matched, false, '三秒内重复结果应去重')
assert.equal(splitWake.push('动伴', true, 5_100).matched, true)
const interimWake = new WakeWordWindow()
assert.equal(interimWake.push(['你好冬半', '你好动伴', '你好动漫'], false, 1_000).matched, false, 'interim 首次命中不应立即唤醒')
assert.equal(interimWake.push(['你好冬半', '你好动伴'], false, 1_100).matched, true, '三个候选中的唤醒词连续命中应触发')

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
