import { createContext, useContext, useEffect, useState } from 'react'
import { equipmentSeed, initialState } from './data'
import type { AppState, Slot, WorkoutSession } from '../types'
import { applyWorkout, calculateDailyMissionProgress } from './rewards'
import { emptyZoneDurations } from './heartRate'
import { migrateWorkoutSession } from './sessionMigration'

type Store = { state: AppState; finishWorkout: (session: WorkoutSession) => WorkoutSession; equip: (slot: Slot, id: string) => void; reset: () => void }
const StoreContext = createContext<Store | null>(null)
const keys = {
  legacy: 'motion-buddy-state', profile: 'motion-buddy:userProfile', history: 'motion-buddy:workoutHistory',
  progress: 'motion-buddy:progress', unlocked: 'motion-buddy:unlockedEquipment', equipped: 'motion-buddy:equippedItems',
}

const read = <T,>(key: string): T | null => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : null } catch { return null } }

function loadState(): AppState {
  const legacy = read<Partial<AppState>>(keys.legacy)
  const profile = read<Pick<AppState, 'gender' | 'nickname' | 'age' | 'streakDays'>>(keys.profile)
  const history = read<WorkoutSession[]>(keys.history) || (legacy?.history as WorkoutSession[] | undefined) || []
  const progress = read<Pick<AppState, 'level' | 'xp' | 'workouts' | 'totalSquats' | 'dailyMissionProgress'>>(keys.progress)
  const unlockedIds = new Set(read<string[]>(keys.unlocked) || legacy?.equipment?.filter(item => item.owned).map(item => item.id) || [])
  const validIds = new Set(equipmentSeed.map(item => item.id))
  const savedEquipped = read<AppState['equipped']>(keys.equipped) || legacy?.equipped || {}
  const equipped = Object.fromEntries(Object.entries(savedEquipped).filter(([, id]) => typeof id === 'string' && validIds.has(id))) as AppState['equipped']
  const equipment = equipmentSeed.map(item => ({ ...item, owned: item.owned || unlockedIds.has(item.id) }))
  const safeHistory = history.filter(item => item && typeof item.startTime === 'string' && typeof item.formScore === 'number').map(item => {
    if ((item.heartRateSource as string | null) === 'ble') return migrateWorkoutSession(item)
    return migrateWorkoutSession({ ...item, currentBpm: null, averageBpm: null, maxBpm: null, heartRateSource: null, ...emptyZoneDurations() })
  })
  return {
    ...initialState, ...legacy, ...profile, ...progress,
    gender: profile?.gender === 'female' || legacy?.gender === 'female' ? 'female' : 'male',
    history: safeHistory, equipment, equipped: { ...initialState.equipped, ...equipped },
    dailyMissionProgress: calculateDailyMissionProgress(safeHistory),
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  useEffect(() => {
    localStorage.setItem(keys.profile, JSON.stringify({ gender: state.gender, nickname: state.nickname, age: state.age, streakDays: state.streakDays }))
    localStorage.setItem(keys.history, JSON.stringify(state.history))
    localStorage.setItem(keys.progress, JSON.stringify({ level: state.level, xp: state.xp, workouts: state.workouts, totalSquats: state.totalSquats, dailyMissionProgress: state.dailyMissionProgress }))
    localStorage.setItem(keys.unlocked, JSON.stringify(state.equipment.filter(item => item.owned).map(item => item.id)))
    localStorage.setItem(keys.equipped, JSON.stringify(state.equipped))
  }, [state])

  const finishWorkout = (raw: WorkoutSession) => {
    const { next, session } = applyWorkout(state, raw)
    setState(next)
    return session
  }
  const equip = (slot: Slot, id: string) => setState(current => ({ ...current, equipped: { ...current.equipped, [slot]: id } }))
  const reset = () => { Object.values(keys).forEach(key => localStorage.removeItem(key)); setState(initialState) }
  return <StoreContext.Provider value={{ state, finishWorkout, equip, reset }}>{children}</StoreContext.Provider>
}

export const useStore = () => {
  const value = useContext(StoreContext)
  if (!value) throw new Error('StoreProvider missing')
  return value
}
