import emeraldStarMedal from '../assets/equipment/badge/emerald_star_medal.png'
import purpleStarShorts from '../assets/equipment/bottom/purple_star_shorts.png'
import sakuraGloves from '../assets/equipment/gloves/sakura_gloves.png'
import penguinHood from '../assets/equipment/head/penguin_hood.png'
import sunsetBandana from '../assets/equipment/head/sunset_bandana.png'
import shibaBottle from '../assets/equipment/prop/shiba_bottle.png'
import cometRunningShoes from '../assets/equipment/shoes/comet_running_shoes.png'
import oceanWaveTop from '../assets/equipment/top/ocean_wave_top.png'
import type { AppState, Equipment } from '../types'

export const equipmentSeed: Equipment[] = [
  { id: 'penguin_hood', name: '企鹅兜帽', slot: 'head', rarity: 'N', image: penguinHood, accent: '#55c9ff', condition: '正式装备素材', owned: true },
  { id: 'sunset_bandana', name: '落日头巾', slot: 'head', rarity: 'N', image: sunsetBandana, accent: '#ff8c64', condition: '正式装备素材', owned: true },
  { id: 'ocean_wave_top', name: '海浪上衣', slot: 'top', rarity: 'N', image: oceanWaveTop, accent: '#3fd9f1', condition: '正式装备素材', owned: true },
  { id: 'purple_star_shorts', name: '紫星短裤', slot: 'bottom', rarity: 'N', image: purpleStarShorts, accent: '#9b74f5', condition: '正式装备素材', owned: true },
  { id: 'comet_running_shoes', name: '彗星跑鞋', slot: 'shoes', rarity: 'N', image: cometRunningShoes, accent: '#52c8ff', condition: '正式装备素材', owned: true },
  { id: 'sakura_gloves', name: '樱花手套', slot: 'gloves', rarity: 'N', image: sakuraGloves, accent: '#ff8eb7', condition: '完成一次动作评分 90+ 的训练', owned: false },
  { id: 'shiba_bottle', name: '柴犬水壶', slot: 'prop', rarity: 'N', image: shibaBottle, accent: '#f2a34a', condition: '正式装备素材', owned: true },
  { id: 'emerald_star_medal', name: '翡翠星勋章', slot: 'badge', rarity: 'N', image: emeraldStarMedal, accent: '#21d98a', condition: '正式装备素材', owned: true },
]

export const initialState: AppState = {
  gender: 'male', nickname: 'Jero', age: 24, level: 1, xp: 0, streakDays: 0, workouts: 0, totalSquats: 0,
  equipment: equipmentSeed,
  equipped: { head: 'penguin_hood', top: 'ocean_wave_top', bottom: 'purple_star_shorts', shoes: 'comet_running_shoes', prop: 'shiba_bottle', badge: 'emerald_star_medal' },
  history: [],
  dailyMissionProgress: { date: '', squatReps: 0, zone3Seconds: 0, hasHighScoreWorkout: false },
}
