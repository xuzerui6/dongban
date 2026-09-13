import { useEffect, useState } from 'react'
import { AvatarFigure } from '../components/AvatarFigure'
import { Header } from '../components/Header'
import { Icon } from '../components/Icons'
import { useStore } from '../lib/store'
import { getOutfitAvatar, outfitLabels, outfitPresets, outfitRarities, outfitUnlockCopy } from '../lib/outfits'
import { requiredXp } from '../lib/rewards'
import type { AvatarGender, OutfitPreset, Slot } from '../types'

const slots: { key: Slot; label: string }[] = [
  { key: 'head', label: '头部' }, { key: 'top', label: '上衣' }, { key: 'bottom', label: '下装' },
  { key: 'shoes', label: '鞋子' }, { key: 'gloves', label: '手套' }, { key: 'prop', label: '道具' },
  { key: 'badge', label: '勋章' }, { key: 'effect', label: '特效' },
]

export function Avatar({ inventory }: { inventory: () => void }) {
  const { state, setAvatarGender, setActiveOutfit, markOutfitsSeen, triggerDemoReward } = useStore()
  const [tab, setTab] = useState<'equip' | 'stats'>('equip')
  const [wearNotice, setWearNotice] = useState('')
  const levelXp = requiredXp(state.level)
  const averageScore = state.history.length ? Math.round(state.history.reduce((sum, session) => sum + session.formScore, 0) / state.history.length) : 0
  const zoneMinutes = Math.floor(state.history.reduce((sum, session) => sum + session.zone3Seconds, 0) / 60)
  const stats: Array<[string, number]> = [
    ['力量', Math.min(100, Math.round(state.totalSquats / 5))], ['耐力', Math.min(100, state.completedWorkoutCount * 5)],
    ['爆发', Math.min(100, state.highScoreWorkoutCount * 10)], ['技巧', averageScore], ['恢复', Math.min(100, zoneMinutes * 2)],
  ]

  useEffect(() => {
    if (!state.newlyUnlockedOutfits.length) return
    const newlyUnlocked = state.newlyUnlockedOutfits
    const timer = window.setTimeout(() => markOutfitsSeen(newlyUnlocked), 1500)
    return () => window.clearTimeout(timer)
  }, [state.newlyUnlockedOutfits, markOutfitsSeen])

  const wearOutfit = (outfit: OutfitPreset) => {
    if (!state.unlockedOutfits[outfit] || state.activeOutfit === outfit) return
    setActiveOutfit(outfit)
    markOutfitsSeen([outfit])
    setWearNotice(`已穿戴 · ${outfitLabels[outfit]}`)
    window.setTimeout(() => setWearNotice(''), 1500)
  }

  return <div className="page avatar-page">
    <Header title="我的形象"/>
    <div className="avatar-showcase"><div className="speech small">每一次训练<br/>都在变强！</div><AvatarFigure view="front"/><b>{state.nickname}</b><div className="level-row"><span>Lv.{state.level}</span><div className="progress"><i style={{ width: `${Math.min(100, state.xp / levelXp * 100)}%` }}/></div><small>{state.xp}/{levelXp} XP</small></div></div>
    <section className="avatar-customize">
      <div className="customize-heading"><span><small>当前套装：</small><b>{outfitLabels[state.activeOutfit]}</b></span><div className="gender-switch" aria-label="角色性别">{([['male', '男'], ['female', '女']] as [AvatarGender, string][]).map(([gender, label]) => <button key={gender} className={state.avatarGender === gender ? 'active' : ''} onClick={() => setAvatarGender(gender)}>{label}</button>)}</div></div>
      <div className="outfit-list">{outfitPresets.map(outfit => {
        const unlocked = state.unlockedOutfits[outfit], active = state.activeOutfit === outfit, isNew = state.newlyUnlockedOutfits.includes(outfit)
        return <article key={outfit} className={`${active ? 'active' : ''} ${unlocked ? '' : 'locked'} rarity-${outfitRarities[outfit]}`}>
          {isNew && <em className="outfit-new">NEW</em>}<img className="pixel-art" src={getOutfitAvatar(state.avatarGender, outfit, 'front')} alt={`${outfitLabels[outfit]}预览`}/><b>{outfitLabels[outfit]}</b><span>{outfitRarities[outfit]}</span><small>{active ? '已穿戴' : unlocked ? '已解锁' : outfitUnlockCopy[outfit]}</small><button disabled={!unlocked || active} onClick={() => wearOutfit(outfit)}>{active ? '已穿戴' : unlocked ? '穿戴' : '未解锁'}</button>
        </article>
      })}</div>
      {wearNotice && <div className="wear-notice" role="status">{wearNotice}</div>}
    </section>
    <div className="segmented"><button className={tab === 'equip' ? 'active' : ''} onClick={() => setTab('equip')}>装备</button><button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>属性</button></div>
    {tab === 'equip' ? <><div className="slot-grid">{slots.map(slot => { const item = state.equipment.find(equipment => equipment.id === state.equipped[slot.key]); return <button key={slot.key} onClick={inventory} className={item ? 'filled' : ''}>{item ? <img className="pixel-art slot-image" src={item.image} alt={item.name}/> : <span className="slot-empty">暂无素材</span>}<b>{slot.label}</b><small>{item?.name || '未装备'}</small></button> })}</div><button className="primary inventory-cta" onClick={inventory}><Icon name="bag"/>更换装备</button></> : <div className="stats-list">{stats.map(([name, value]) => <div key={name}><span>{name}</span><div className="progress"><i style={{ width: `${value}%` }}/></div><b>{value}</b></div>)}</div>}
    {import.meta.env.DEV && <button className="demo-reward-trigger" onClick={triggerDemoReward}>Demo Reward Trigger · +300 XP</button>}
  </div>
}
