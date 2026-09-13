import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { equipmentSeed, initialState } from './data'
import type { AppState, Slot, WorkoutSession } from '../types'
import { applyWorkout, calculateDailyMissionProgress, evaluateOutfitUnlocks, progressFromTotalXp, totalXpFromProgress } from './rewards'
import { emptyZoneDurations } from './heartRate'
import { migrateWorkoutSession } from './sessionMigration'
import { outfitPresets } from './outfits'

type Store = {
  state: AppState
  finishWorkout: (session: WorkoutSession) => WorkoutSession
  equip: (slot: Slot, id: string) => void
  setAvatarGender: (gender: AppState['avatarGender']) => void
  setActiveOutfit: (outfit: AppState['activeOutfit']) => void
  markOutfitsSeen: (outfits?: AppState['newlyUnlockedOutfits']) => void
  triggerDemoReward: () => void
  reset: () => void
}
const StoreContext = createContext<Store | null>(null)
const keys = {
  legacy: 'motion-buddy-state', profile: 'motion-buddy:userProfile', history: 'motion-buddy:workoutHistory',
  progress: 'motion-buddy:progress', unlocked: 'motion-buddy:unlockedEquipment', equipped: 'motion-buddy:equippedItems',
  avatarGender: 'avatarGender', activeOutfit: 'activeOutfit', unlockedOutfits: 'unlockedOutfits',
  totalXp: 'totalXp', completedWorkoutCount: 'completedWorkoutCount', highScoreWorkoutCount: 'highScoreWorkoutCount',
  seenOutfits: 'seenOutfits', newlyUnlockedOutfits: 'newlyUnlockedOutfits',
}

const read = <T,>(key: string): T | null => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : null } catch { return null } }

function loadState(): AppState {
  const legacy = read<Partial<AppState>>(keys.legacy)
  const profile = read<{ gender?: string; avatarGender?: string; nickname?: string; age?: number; streakDays?: number }>(keys.profile)
  const history = read<WorkoutSession[]>(keys.history) || (legacy?.history as WorkoutSession[] | undefined) || []
  const progress = read<Partial<Pick<AppState, 'level' | 'xp' | 'totalXp' | 'workouts' | 'completedWorkoutCount' | 'highScoreWorkoutCount' | 'totalSquats' | 'dailyMissionProgress'>>>(keys.progress)
  const unlockedIds = new Set(read<string[]>(keys.unlocked) || legacy?.equipment?.filter(item => item.owned).map(item => item.id) || [])
  const validIds = new Set(equipmentSeed.map(item => item.id))
  const savedEquipped = read<AppState['equipped']>(keys.equipped) || legacy?.equipped || {}
  const equipped = Object.fromEntries(Object.entries(savedEquipped).filter(([, id]) => typeof id === 'string' && validIds.has(id))) as AppState['equipped']
  const equipment = equipmentSeed.map(item => ({ ...item, owned: item.owned || unlockedIds.has(item.id) }))
  const safeHistory = history.filter(item => item && typeof item.startTime === 'string' && typeof item.formScore === 'number').map(item => {
    if ((item.heartRateSource as string | null) === 'ble') return migrateWorkoutSession(item)
    return migrateWorkoutSession({ ...item, currentBpm: null, averageBpm: null, maxBpm: null, heartRateSource: null, ...emptyZoneDurations() })
  })
  const savedGender = read<string>(keys.avatarGender) || profile?.avatarGender || profile?.gender || (legacy as { gender?: string } | null)?.gender || legacy?.avatarGender
  const avatarGender = savedGender === 'female' ? 'female' : 'male'
  const savedOutfits = read<Partial<AppState['unlockedOutfits']>>(keys.unlockedOutfits) || legacy?.unlockedOutfits || {}
  const savedLevel = progress?.level ?? legacy?.level ?? initialState.level
  const savedXp = progress?.xp ?? legacy?.xp ?? initialState.xp
  const totalXp = read<number>(keys.totalXp) ?? progress?.totalXp ?? legacy?.totalXp ?? totalXpFromProgress(savedLevel, savedXp)
  const normalizedProgress = progressFromTotalXp(totalXp)
  const completedWorkoutCount = read<number>(keys.completedWorkoutCount) ?? progress?.completedWorkoutCount ?? legacy?.completedWorkoutCount ?? progress?.workouts ?? legacy?.workouts ?? safeHistory.length
  const highScoreWorkoutCount = read<number>(keys.highScoreWorkoutCount) ?? progress?.highScoreWorkoutCount ?? legacy?.highScoreWorkoutCount ?? safeHistory.filter(item => item.formScore >= 90).length
  const totalSquats = progress?.totalSquats ?? legacy?.totalSquats ?? initialState.totalSquats
  const baseUnlockedOutfits: AppState['unlockedOutfits'] = {
    default: true,
    penguin: Boolean(savedOutfits.penguin),
    sakura: Boolean(savedOutfits.sakura),
    sunset_sakura: Boolean(savedOutfits.sunset_sakura),
  }
  const evaluated = evaluateOutfitUnlocks({ unlockedOutfits: baseUnlockedOutfits, completedWorkoutCount, highScoreWorkoutCount, totalXp, level: normalizedProgress.level })
  const savedSeen = read<string[]>(keys.seenOutfits) || legacy?.seenOutfits || ['default']
  const seenOutfits = outfitPresets.filter(outfit => savedSeen.includes(outfit))
  const savedNew = read<string[]>(keys.newlyUnlockedOutfits) || legacy?.newlyUnlockedOutfits || []
  const newlyUnlockedOutfits = outfitPresets.filter(outfit => (savedNew.includes(outfit) || evaluated.newlyUnlockedOutfits.includes(outfit)) && !seenOutfits.includes(outfit))
  const savedActiveOutfit = read<string>(keys.activeOutfit) || legacy?.activeOutfit
  const activeOutfit = outfitPresets.includes(savedActiveOutfit as AppState['activeOutfit']) && evaluated.unlockedOutfits[savedActiveOutfit as AppState['activeOutfit']]
    ? savedActiveOutfit as AppState['activeOutfit']
    : 'default'
  return {
    ...initialState, ...legacy, ...profile, ...progress,
    avatarGender, activeOutfit, unlockedOutfits: evaluated.unlockedOutfits, seenOutfits, newlyUnlockedOutfits,
    level: normalizedProgress.level, xp: normalizedProgress.xp, totalXp,
    workouts: completedWorkoutCount, completedWorkoutCount, highScoreWorkoutCount, totalSquats,
    history: safeHistory, equipment, equipped: { ...initialState.equipped, ...equipped },
    dailyMissionProgress: calculateDailyMissionProgress(safeHistory),
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const settledSessions = useRef(new Map(state.history.map(session => [session.id, session])))
  useEffect(() => {
    localStorage.setItem(keys.profile, JSON.stringify({ gender: state.avatarGender, avatarGender: state.avatarGender, nickname: state.nickname, age: state.age, streakDays: state.streakDays }))
    localStorage.setItem(keys.avatarGender, JSON.stringify(state.avatarGender))
    localStorage.setItem(keys.activeOutfit, JSON.stringify(state.activeOutfit))
    localStorage.setItem(keys.unlockedOutfits, JSON.stringify(state.unlockedOutfits))
    localStorage.setItem(keys.totalXp, JSON.stringify(state.totalXp))
    localStorage.setItem(keys.completedWorkoutCount, JSON.stringify(state.completedWorkoutCount))
    localStorage.setItem(keys.highScoreWorkoutCount, JSON.stringify(state.highScoreWorkoutCount))
    localStorage.setItem(keys.seenOutfits, JSON.stringify(state.seenOutfits))
    localStorage.setItem(keys.newlyUnlockedOutfits, JSON.stringify(state.newlyUnlockedOutfits))
    localStorage.setItem(keys.history, JSON.stringify(state.history))
    localStorage.setItem(keys.progress, JSON.stringify({ level: state.level, xp: state.xp, totalXp: state.totalXp, workouts: state.workouts, completedWorkoutCount: state.completedWorkoutCount, highScoreWorkoutCount: state.highScoreWorkoutCount, totalSquats: state.totalSquats, dailyMissionProgress: state.dailyMissionProgress }))
    localStorage.setItem(keys.unlocked, JSON.stringify(state.equipment.filter(item => item.owned).map(item => item.id)))
    localStorage.setItem(keys.equipped, JSON.stringify(state.equipped))
  }, [state])

  const finishWorkout = (raw: WorkoutSession) => {
    const settled = settledSessions.current.get(raw.id)
    if (settled) return settled
    const { next, session } = applyWorkout(state, raw)
    settledSessions.current.set(raw.id, session)
    setState(next)
    return session
  }
  const equip = (slot: Slot, id: string) => setState(current => ({ ...current, equipped: { ...current.equipped, [slot]: id } }))
  const setAvatarGender = (avatarGender: AppState['avatarGender']) => setState(current => ({ ...current, avatarGender }))
  const setActiveOutfit = (activeOutfit: AppState['activeOutfit']) => setState(current => current.unlockedOutfits[activeOutfit] ? ({ ...current, activeOutfit }) : current)
  const markOutfitsSeen = (outfits = state.newlyUnlockedOutfits) => setState(current => ({
    ...current,
    seenOutfits: [...new Set([...current.seenOutfits, ...outfits])],
    newlyUnlockedOutfits: current.newlyUnlockedOutfits.filter(outfit => !outfits.includes(outfit)),
  }))
  const triggerDemoReward = () => setState(current => {
    const now = new Date()
    const session: WorkoutSession = {
      id: `demo-${now.getTime()}`, exerciseType: 'squat', startTime: now.toISOString(), endTime: now.toISOString(), durationSeconds: 60,
      reps: 100, targetReps: 100, formScore: 92, perfectReps: 100, feedback: 'Demo reward', phase: 'standing',
      currentBpm: null, averageBpm: null, maxBpm: null, heartRateSource: null,
      zone1Seconds: 0, zone2Seconds: 0, zone3Seconds: 0, zone4Seconds: 0, zone5Seconds: 0,
      xpEarned: 0, unlocked: [], formBreakdown: { depth: 92, stability: 92, trunk: 92, symmetry: 92 },
      correctionCounts: { out_of_frame: 0, insufficient_depth: 0, knee_instability: 0, excessive_trunk_lean: 0, asymmetry: 0 }, visionInsights: [], conversationTurnCount: 0,
    }
    const result = applyWorkout(current, session, false)
    settledSessions.current.set(session.id, result.session)
    return result.next
  })
  const reset = () => { Object.values(keys).forEach(key => localStorage.removeItem(key)); settledSessions.current.clear(); setState(initialState) }
  return <StoreContext.Provider value={{ state, finishWorkout, equip, setAvatarGender, setActiveOutfit, markOutfitsSeen, triggerDemoReward, reset }}>{children}</StoreContext.Provider>
}

export const useStore = () => {
  const value = useContext(StoreContext)
  if (!value) throw new Error('StoreProvider missing')
  return value
}
