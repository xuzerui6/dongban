import { useMemo, useState } from 'react'
import { Header } from '../components/Header'
import { useStore } from '../lib/store'
import type { Rarity } from '../types'

const rarityLabel: Record<Rarity, string> = { N: '普通', R: '稀有', SR: '超稀有', SSR: '典藏' }

export function Inventory() {
  const { state, equip } = useStore()
  const [filter, setFilter] = useState<'all' | 'owned' | 'locked'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const items = useMemo(() => state.equipment.filter(item => filter === 'all' || (filter === 'owned' ? item.owned : !item.owned)), [state.equipment, filter])
  const current = state.equipment.find(item => item.id === selected)
  const wear = () => {
    if (current?.owned) equip(current.slot, current.id)
    setSelected(null)
  }

  return <div className="page inventory-page">
    <Header title="背包"/>
    <div className="inventory-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部装备</button><button className={filter === 'owned' ? 'active' : ''} onClick={() => setFilter('owned')}>已获得</button><button className={filter === 'locked' ? 'active' : ''} onClick={() => setFilter('locked')}>未解锁</button></div>
    <div className="inventory-meta"><b>{items.length} 件物品</b><span>按稀有度 ↓</span></div>
    <div className="inventory-grid">{items.map(item => {
      const equipped = Object.values(state.equipped).includes(item.id)
      return <button key={item.id} onClick={() => setSelected(item.id)} className={`${item.owned ? 'owned' : 'locked'} rarity-${item.rarity}`}>
        <em>{item.rarity}</em><img className="pixel-art equipment-image" src={item.image} alt={item.name}/><b>{item.name}</b><small>{equipped ? '已装备' : item.owned ? '已拥有' : '未解锁'}</small>
      </button>
    })}</div>
    <div className="inventory-tip">通过持续训练，解锁更多装备<br/><span>让你的动伴形象更加强悍！</span></div>
    {current && <div className="modal-backdrop bottom"><div className="item-sheet"><button className="modal-close" onClick={() => setSelected(null)}>×</button><img className="pixel-art equipment-image big" src={current.image} alt={current.name}/><span className={`rarity-label rarity-${current.rarity}`}>{current.rarity} · {rarityLabel[current.rarity]}</span><h3>{current.name}</h3><p>{current.owned ? '这件装备已经属于你，可以立即放入对应装备槽位。' : `解锁条件：${current.condition}`}</p><button className="primary" disabled={!current.owned} onClick={wear}>{current.owned ? '立即装备' : '继续训练以解锁'}</button></div></div>}
  </div>
}
