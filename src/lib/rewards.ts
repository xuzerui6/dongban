import type { AppState, DailyMissionProgress, WorkoutSession } from '../types'

export function calculateWorkoutXP(session: WorkoutSession) {
  const baseXP = session.reps * 3
  const qualityMultiplier = session.formScore >= 90 ? 1.2 : session.formScore >= 80 ? 1.1 : 1
  const heartRateBonus = session.zone3Seconds >= 300 ? 50 : 0
  return Math.round(baseXP * qualityMultiplier + heartRateBonus)
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

export function applyWorkout(state: AppState, rawSession: WorkoutSession) {
  const xpEarned = calculateWorkoutXP(rawSession)
  const unlocked: string[] = []
  const equipment = state.equipment.map(item => {
    if (item.id === 'sakura_gloves' && !item.owned && rawSession.formScore >= 90) { unlocked.push(item.id); return { ...item, owned: true } }
    return item
  })
  const session: WorkoutSession = { ...rawSession, xpEarned, unlocked }
  let level = state.level, xp = state.xp + xpEarned
  while (xp >= 1000) { xp -= 1000; level += 1 }
  const history = [session, ...state.history].slice(0, 100)
  const next = { ...state, xp, level, streakDays: calculateStreakDays(history), workouts: state.workouts + 1, totalSquats: state.totalSquats + session.reps, equipment, history, dailyMissionProgress: calculateDailyMissionProgress(history) }
  return { next, session }
}
