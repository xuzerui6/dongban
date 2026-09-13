import type { AppState, DailyMissionProgress, OutfitPreset, WorkoutSession } from '../types'

export const requiredXp = (level: number) => 300 + (Math.max(1, level) - 1) * 100

export function calculateWorkoutXp(session: Pick<WorkoutSession, 'reps' | 'formScore'>) {
  const qualityXp = session.formScore >= 90 ? 50 : session.formScore >= 80 ? 20 : 0
  return Math.min(300, 50 + Math.max(0, session.reps) * 2 + qualityXp)
}

/** Legacy export kept for callers outside this repository. */
export const calculateWorkoutXP = calculateWorkoutXp

export function totalXpFromProgress(level: number, xp: number) {
  let total = Math.max(0, xp)
  for (let current = 1; current < Math.max(1, level); current += 1) total += requiredXp(current)
  return total
}

export function progressFromTotalXp(totalXp: number) {
  let level = 1
  let xp = Math.max(0, totalXp)
  while (xp >= requiredXp(level)) { xp -= requiredXp(level); level += 1 }
  return { level, xp }
}

export const localDateKey = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function calculateDailyMissionProgress(history: WorkoutSession[], date = new Date()): DailyMissionProgress {
  const dateKey = localDateKey(date)
  const today = history.filter(session => session.startTime && localDateKey(new Date(session.startTime)) === dateKey)
  return {
    date: dateKey,
    squatReps: today.reduce((sum, session) => sum + session.reps, 0),
    zone3Seconds: today.reduce((sum, session) => sum + session.zone3Seconds, 0),
    hasHighScoreWorkout: today.some(session => session.formScore >= 90),
  }
}

export function calculateStreakDays(history: WorkoutSession[]) {
  const trainedDates = new Set(history.filter(session => session.startTime).map(session => localDateKey(new Date(session.startTime))))
  let cursor = new Date(), streak = 0
  if (!trainedDates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (trainedDates.has(localDateKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1) }
  return streak
}

function calculateMissionXp(before: DailyMissionProgress, after: DailyMissionProgress) {
  let xp = 0
  if (before.squatReps < 20 && after.squatReps >= 20) xp += 60
  if (before.zone3Seconds < 300 && after.zone3Seconds >= 300) xp += 40
  if (!before.hasHighScoreWorkout && after.hasHighScoreWorkout) xp += 100
  return xp
}

export function evaluateOutfitUnlocks(state: Pick<AppState, 'unlockedOutfits' | 'completedWorkoutCount' | 'highScoreWorkoutCount' | 'totalXp' | 'level'>) {
  const unlockedOutfits = { ...state.unlockedOutfits, default: true }
  const newlyUnlockedOutfits: OutfitPreset[] = []
  const unlock = (outfit: OutfitPreset, condition: boolean) => {
    if (condition && !unlockedOutfits[outfit]) { unlockedOutfits[outfit] = true; newlyUnlockedOutfits.push(outfit) }
  }
  unlock('penguin', state.completedWorkoutCount >= 3)
  unlock('sakura', state.highScoreWorkoutCount >= 3)
  unlock('sunset_sakura', (state.completedWorkoutCount >= 5 && state.totalXp >= 1000) || state.level >= 5)
  return { unlockedOutfits, newlyUnlockedOutfits }
}

export function applyWorkout(state: AppState, rawSession: WorkoutSession, includeMissionRewards = true) {
  const alreadySettled = state.history.find(session => session.id === rawSession.id)
  if (alreadySettled) return { next: state, session: alreadySettled }

  const baseXpEarned = calculateWorkoutXp(rawSession)
  const sessionDate = Number.isNaN(new Date(rawSession.startTime).getTime()) ? new Date() : new Date(rawSession.startTime)
  const beforeMissions = calculateDailyMissionProgress(state.history, sessionDate)
  const afterMissions = calculateDailyMissionProgress([rawSession, ...state.history], sessionDate)
  const missionXpEarned = includeMissionRewards ? calculateMissionXp(beforeMissions, afterMissions) : 0
  const xpEarned = baseXpEarned + missionXpEarned
  const unlocked: string[] = []
  const equipment = state.equipment.map(item => {
    if (item.id === 'sakura_gloves' && !item.owned && rawSession.formScore >= 90) { unlocked.push(item.id); return { ...item, owned: true } }
    return item
  })
  const completedWorkoutCount = state.completedWorkoutCount + 1
  const highScoreWorkoutCount = state.highScoreWorkoutCount + (rawSession.formScore >= 90 ? 1 : 0)
  const completedSquats = state.totalSquats + rawSession.reps
  const levelBefore = state.level
  const xpBefore = state.xp
  let level = levelBefore, xp = xpBefore + xpEarned
  while (xp >= requiredXp(level)) { xp -= requiredXp(level); level += 1 }
  const totalXp = state.totalXp + xpEarned
  const evaluated = evaluateOutfitUnlocks({ ...state, level, totalXp, completedWorkoutCount, highScoreWorkoutCount })
  const session: WorkoutSession = {
    ...rawSession, xpEarned, baseXpEarned, missionXpEarned, xpBefore, xpAfter: xp, levelBefore, levelAfter: level,
    unlocked, unlockedOutfits: evaluated.newlyUnlockedOutfits,
  }
  const history = [session, ...state.history].slice(0, 100)
  const pendingOutfits = [...new Set([...state.newlyUnlockedOutfits, ...evaluated.newlyUnlockedOutfits])]
  const next: AppState = {
    ...state, xp, level, totalXp, streakDays: calculateStreakDays(history), workouts: completedWorkoutCount,
    completedWorkoutCount, highScoreWorkoutCount, totalSquats: completedSquats, equipment,
    unlockedOutfits: evaluated.unlockedOutfits, newlyUnlockedOutfits: pendingOutfits,
    history, dailyMissionProgress: calculateDailyMissionProgress(history),
  }
  return { next, session }
}
