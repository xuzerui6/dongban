import type { HeartRateZone, ZoneDurations } from '../types'

export const emptyZoneDurations = (): ZoneDurations => ({
  zone1Seconds: 0, zone2Seconds: 0, zone3Seconds: 0, zone4Seconds: 0, zone5Seconds: 0,
})

export function getHeartRateZone(bpm: number | null, age: number): HeartRateZone | null {
  if (!bpm || bpm <= 0) return null
  const ratio = bpm / Math.max(1, 220 - age)
  if (ratio < 0.6) return 1
  if (ratio < 0.7) return 2
  if (ratio < 0.8) return 3
  if (ratio < 0.9) return 4
  return 5
}

export function incrementZone(durations: ZoneDurations, zone: HeartRateZone | null, seconds = 1): ZoneDurations {
  const next: ZoneDurations = {
    zone1Seconds: durations.zone1Seconds, zone2Seconds: durations.zone2Seconds, zone3Seconds: durations.zone3Seconds,
    zone4Seconds: durations.zone4Seconds, zone5Seconds: durations.zone5Seconds,
  }
  if (!zone) return next
  const key = `zone${zone}Seconds` as keyof ZoneDurations
  next[key] += seconds
  return next
}
