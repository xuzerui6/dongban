import { useState } from 'react'
import { AvatarFigure } from '../components/AvatarFigure'
import { Header } from '../components/Header'
import { Icon } from '../components/Icons'
import { useStore } from '../lib/store'
import type { Slot } from '../types'

const slots: { key: Slot; label: string }[] = [
  { key: 'head', label: '头部' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'shoes', label: '鞋子' },
  { key: 'gloves', label: '手套' },
  { key: 'prop', label: '道具' },
  { key: 'badge', label: '勋章' },
  { key: 'effect', label: '特效' },
]

export function Avatar({ inventory }: { inventory: () => void }) {
  const { state } = useStore()
  const [tab, setTab] = useState<'equip' | 'stats'>('equip')
  const averageScore = state.history.length ? Math.round(state.history.reduce((sum, session) => sum + session.formScore, 0) / state.history.length) : 0
  const zoneMinutes = Math.floor(state.history.reduce((sum, session) => sum + session.zone3Seconds, 0) / 60)
  const stats: Array<[string, number]> = [
    ['力量', Math.min(100, Math.round(state.totalSquats / 5))],
    ['耐力', Math.min(100, state.workouts * 5)],
    ['爆发', Math.min(100, state.history.filter(session => session.formScore >= 90).length * 10)],
    ['技巧', averageScore],
    ['恢复', Math.min(100, zoneMinutes * 2)],
  ]

  return <div className="page avatar-page">
    <Header title="我的形象"/>
    <div className="avatar-showcase">
      <div className="speech small">每一次训练<br/>都在变强！</div>
      <AvatarFigure view="front"/>
      <b>{state.nickname}</b>
      <div className="level-row"><span>Lv.{state.level}</span><div className="progress"><i style={{ width: `${state.xp / 10}%` }}/></div><small>{state.xp}/1000 XP</small></div>
    </div>
    <div className="segmented"><button className={tab === 'equip' ? 'active' : ''} onClick={() => setTab('equip')}>装备</button><button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>属性</button></div>
    {tab === 'equip' ? <>
      <div className="slot-grid">{slots.map(slot => {
        const item = state.equipment.find(equipment => equipment.id === state.equipped[slot.key])
        return <button key={slot.key} onClick={inventory} className={item ? 'filled' : ''}>
          {item ? <img className="pixel-art slot-image" src={item.image} alt={item.name}/> : <span className="slot-empty">暂无素材</span>}
          <b>{slot.label}</b><small>{item?.name || '未装备'}</small>
        </button>
      })}</div>
      <button className="primary inventory-cta" onClick={inventory}><Icon name="bag"/>更换装备</button>
    </> : <div className="stats-list">{stats.map(([name, value]) => <div key={name}><span>{name}</span><div className="progress"><i style={{ width: `${value}%` }}/></div><b>{value}</b></div>)}</div>}
  </div>
}
