import assert from 'node:assert/strict'
import { getHeartRateZone } from '../src/lib/heartRate'
import { calculateWorkoutXP } from '../src/lib/rewards'
import { parseHeartRateMeasurement } from '../src/services/bleHeartRate'
import type { WorkoutSession } from '../src/types'

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
}
assert.equal(calculateWorkoutXP(session), 122, 'XP 应为 round(20*3*1.2+50)')
console.log('Core data tests passed: BLE flags, HR zones, workout XP')
