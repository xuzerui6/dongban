import { AvatarFigure } from '../components/AvatarFigure'
import { Icon } from '../components/Icons'
import { useStore } from '../lib/store'
import { outfitLabels, outfitRarities } from '../lib/outfits'
import { POSE_ISSUE_COPY } from '../lib/poseFeedback'
import { requiredXp } from '../lib/rewards'
import type { PoseIssue, WorkoutSession } from '../types'

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

export function Summary({ result, avatar, home }: { result: WorkoutSession; avatar: () => void; home: () => void }) {
  const { state, setActiveOutfit, markOutfitsSeen } = useStore()
  const grade = result.formScore >= 90 ? 'S' : result.formScore >= 80 ? 'A' : result.formScore >= 70 ? 'B' : 'C'
  const zones = [result.zone1Seconds, result.zone2Seconds, result.zone3Seconds, result.zone4Seconds, result.zone5Seconds]
  const corrections = (Object.entries(result.correctionCounts || {}) as [PoseIssue, number][]).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1])
  const breakdown = [['下蹲深度', result.formBreakdown?.depth || 0], ['膝盖稳定', result.formBreakdown?.stability || 0], ['躯干控制', result.formBreakdown?.trunk || 0], ['左右对称', result.formBreakdown?.symmetry || 0]] as const
  const levelBefore = result.levelBefore ?? state.level
  const levelAfter = result.levelAfter ?? state.level
  const xpBefore = result.xpBefore ?? Math.max(0, state.xp - result.xpEarned)
  const xpAfter = result.xpAfter ?? state.xp
  const levelUp = levelAfter > levelBefore
  const unlockedOutfits = result.unlockedOutfits || []
  const wear = (outfit: typeof state.activeOutfit) => { setActiveOutfit(outfit); markOutfitsSeen([outfit]) }

  return <div className="page summary-page">
    <div className="summary-hero"><span className="eyebrow">WORKOUT COMPLETE</span><h2>训练完成！</h2><p>{result.reps} 次深蹲 · 动作评分 {result.formScore}</p><div className="summary-avatar"><AvatarFigure view="front"/></div><div className="xp-earned">+{result.xpEarned} <small>XP</small></div></div>
    <section className="summary-sheet">
      <div className="score-title"><div className="big-score">{result.formScore}<small>分</small></div><div><b>{result.formScore >= 90 ? '稳定完成这一组' : '这一组认真做完了'}</b><span>{result.perfectReps} 次高质量动作 · {result.conversationTurnCount || 0} 轮陪练对话</span></div><span className="grade">{grade}</span></div>
      <div className="summary-grid"><div><small>训练时长</small><b>{fmt(result.durationSeconds)}</b></div><div><small>完成次数</small><b>{result.reps} 次</b></div><div><small>平均心率</small><b>{result.averageBpm !== null ? `${result.averageBpm} BPM` : '无数据'}</b></div><div><small>最高心率</small><b>{result.maxBpm !== null ? `${result.maxBpm} BPM` : '无数据'}</b></div></div>

      <div className="reward-stack">
        <div className="summary-xp-reward"><span><small>本次获得</small><b>+{result.xpEarned} XP</b></span><div><small>训练 {result.baseXpEarned ?? result.xpEarned} XP{result.missionXpEarned ? ` · 任务 ${result.missionXpEarned} XP` : ''}</small><strong>{xpBefore} → {xpAfter} / {requiredXp(levelAfter)}</strong></div><div className="progress"><i style={{ width: `${Math.min(100, xpAfter / requiredXp(levelAfter) * 100)}%` }}/></div></div>
        {levelUp && <div className="level-up-card"><small>LEVEL UP</small><b>等级提升！</b><strong>Lv.{levelBefore} → Lv.{levelAfter}</strong></div>}
        {unlockedOutfits.map(outfit => <div className={`outfit-unlock-card rarity-${outfitRarities[outfit]}`} key={outfit}><AvatarFigure size="small" view="front" outfit={outfit}/><span><small>新套装解锁！ · {outfitRarities[outfit]}</small><b>{outfitLabels[outfit]}</b></span><button disabled={state.activeOutfit === outfit} onClick={() => wear(outfit)}>{state.activeOutfit === outfit ? '已穿戴' : '立即穿戴'}</button></div>)}
        {result.unlocked.includes('sakura_gloves') && <><div className="achievement-row"><Icon name="spark"/><span><small>ACHIEVEMENT</small><b>精准掌控</b></span></div><div className="equipment-reward"><span><small>新装备</small><b>樱花手套 · SR</b></span></div></>}
      </div>

      <div className="form-breakdown"><div className="section-title"><b>动作维度</b><span>本地 MediaPipe</span></div>{breakdown.map(([label, score]) => <div key={label}><span>{label}</span><i><b style={{ width: `${score}%` }}/></i><em>{score || '--'}</em></div>)}</div>
      <div className="correction-summary"><div className="section-title"><b>本组调整线索</b><span>{corrections.length ? '继续关注' : '整体稳定'}</span></div>{corrections.length ? corrections.slice(0, 3).map(([issue, count]) => <span key={issue}><b>{POSE_ISSUE_COPY[issue].label}</b><em>{count} 次</em></span>) : <p>没有持续出现的姿势问题，下一组继续保持节奏。</p>}</div>
      {result.visionInsights?.length > 0 && <div className="vision-summary"><div className="section-title"><b>视觉复核摘要</b><span>不保存图片</span></div><p>{result.visionInsights[result.visionInsights.length - 1].summary}</p></div>}
      <div className="zone-summary">{zones.map((seconds, index) => <div key={index}><span>Zone {index + 1}</span><b>{fmt(seconds)}</b></div>)}</div>
      <div className="reward-row"><Icon name="spark"/><span><b>成长已记录</b><small>{result.heartRateSource === 'ble' ? '心率来源：BLE 设备' : '本次未收到 BLE 心率包'}</small></span><em>+{result.xpEarned} XP</em></div>
      <button className="primary" onClick={avatar}>查看我的形象 <Icon name="arrow"/></button><button className="text-btn" onClick={home}>返回首页</button>
    </section>
  </div>
}
