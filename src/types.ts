export type Route = 'home' | 'workout' | 'summary' | 'avatar' | 'inventory'
export type AvatarGender = 'male' | 'female'
export type OutfitPreset = 'default' | 'penguin' | 'sakura' | 'sunset_sakura'
export type AvatarView = 'front' | 'side'
export type Slot = 'head' | 'top' | 'bottom' | 'shoes' | 'gloves' | 'prop' | 'badge' | 'effect'
export type Rarity = 'N' | 'R' | 'SR' | 'SSR'
export type HeartRateZone = 1 | 2 | 3 | 4 | 5
export type WorkoutPhase = 'standing' | 'descending' | 'bottom' | 'ascending'
export type XiaozhiState = 'off' | 'idle' | 'activating' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'fallback' | 'failed'
export type CoachEmotion = 'neutral' | 'listening' | 'thinking' | 'happy' | 'confident' | 'caring' | 'concerned' | 'celebrating'
export type PoseIssue = 'out_of_frame' | 'insufficient_depth' | 'knee_instability' | 'excessive_trunk_lean' | 'asymmetry'
export type PoseConfidence = 'stable' | 'adjust' | 'uncertain'

export interface FormBreakdown {
  depth: number
  stability: number
  trunk: number
  symmetry: number
}

export interface PoseFeedback {
  status: PoseConfidence
  confidence: number
  issues: PoseIssue[]
  primaryIssue: PoseIssue | null
  message: string
  affectedJoints: number[]
  calibrated: boolean
}

export interface VisionInsight {
  id: string
  createdAt: string
  trigger: 'user' | 'completed_rep' | 'repeated_issue'
  issue: PoseIssue | null
  rep?: number
  summary: string
}

export interface XiaozhiEnvelope<T = unknown> {
  type: string
  session_id?: string
  payload?: T
  [key: string]: unknown
}

export interface McpTextResult {
  content: Array<{ type: 'text'; text: string }>
  isError: boolean
}

export interface VisionFrameJob {
  id: string
  rep: number | null
  image: string
  question: string
  trigger: VisionInsight['trigger']
  issue: PoseIssue | null
  retries: number
  priority: 'user' | 'automatic'
  mcpId?: string | number
  sessionId?: string
}

export interface XiaozhiDataSyncState {
  mcpReady: boolean
  lastRepSynced: number
  visionRep: number | null
  visionStatus: 'idle' | 'queued' | 'reviewed' | 'failed'
  wakeDetected: boolean
}

export interface WorkoutContext {
  reps: number
  targetReps: number
  phase: WorkoutPhase
  durationSeconds: number
  bpm: number | null
  active: boolean
  poseStatus: PoseConfidence
  poseIssues: PoseIssue[]
  recentScore: number
  lastRepAt: string | null
  lastRepIssues: PoseIssue[]
  latestVisionInsight: VisionInsight | null
}

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
  baseXpEarned?: number
  missionXpEarned?: number
  xpBefore?: number
  xpAfter?: number
  levelBefore?: number
  levelAfter?: number
  unlocked: string[]
  unlockedOutfits?: OutfitPreset[]
  formBreakdown: FormBreakdown
  correctionCounts: Record<PoseIssue, number>
  visionInsights: VisionInsight[]
  conversationTurnCount: number
}

export interface DailyMissionProgress {
  date: string
  squatReps: number
  zone3Seconds: number
  hasHighScoreWorkout: boolean
}

export interface AppState {
  avatarGender: AvatarGender
  activeOutfit: OutfitPreset
  unlockedOutfits: Record<OutfitPreset, boolean>
  seenOutfits: OutfitPreset[]
  newlyUnlockedOutfits: OutfitPreset[]
  nickname: string
  age: number
  level: number
  xp: number
  totalXp: number
  streakDays: number
  workouts: number
  completedWorkoutCount: number
  highScoreWorkoutCount: number
  totalSquats: number
  equipment: Equipment[]
  equipped: Partial<Record<Slot, string>>
  history: WorkoutSession[]
  dailyMissionProgress: DailyMissionProgress
}
