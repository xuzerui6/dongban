export type Route = 'home' | 'workout' | 'summary' | 'avatar' | 'inventory'
export type Slot = 'head' | 'top' | 'bottom' | 'shoes' | 'gloves' | 'prop' | 'badge' | 'effect'
export type Rarity = 'N' | 'R' | 'SR' | 'SSR'
export type HeartRateZone = 1 | 2 | 3 | 4 | 5
export type WorkoutPhase = 'standing' | 'descending' | 'bottom' | 'ascending'

export interface Equipment {
  id: string
  name: string
  slot: Slot
  rarity: Rarity
  image: string
  accent: string
  condition: string
  owned: boolean
}

export interface WorkoutMetrics {
  reps: number
  targetReps: number
  formScore: number
  perfectReps: number
  feedback: string
  phase: WorkoutPhase
}

export interface ZoneDurations {
  zone1Seconds: number
  zone2Seconds: number
  zone3Seconds: number
  zone4Seconds: number
  zone5Seconds: number
}

export interface WorkoutSession extends WorkoutMetrics, ZoneDurations {
  id: string
  exerciseType: 'squat'
  startTime: string
  endTime: string | null
  durationSeconds: number
  currentBpm: number | null
  averageBpm: number | null
  maxBpm: number | null
  heartRateSource: 'ble' | null
  xpEarned: number
  unlocked: string[]
}

export interface DailyMissionProgress {
  date: string
  squatReps: number
  zone3Seconds: number
  hasHighScoreWorkout: boolean
}

export interface AppState {
  gender: 'male' | 'female'
  nickname: string
  age: number
  level: number
  xp: number
  streakDays: number
  workouts: number
  totalSquats: number
  equipment: Equipment[]
  equipped: Partial<Record<Slot, string>>
  history: WorkoutSession[]
  dailyMissionProgress: DailyMissionProgress
}
