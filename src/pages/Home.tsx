import { AvatarFigure } from '../components/AvatarFigure'
import { Header } from '../components/Header'
import { Icon } from '../components/Icons'
import { useStore } from '../lib/store'
import { useHeartRateMonitor } from '../hooks/useHeartRateMonitor'
import { calculateDailyMissionProgress, localDateKey } from '../lib/rewards'

export function Home({ start }: { start: () => void }) {
  const { state } = useStore()
  const heartRate = useHeartRateMonitor(state.age)
  const daily = calculateDailyMissionProgress(state.history)
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index))
    const key = localDateKey(date)
    return state.history.filter(session => localDateKey(new Date(session.startTime)) === key).length
  })
  const trainedThisWeek = week.filter(count => count > 0).length
  const tasks = [
    { name: '深蹲 20 次', value: Math.min(daily.squatReps, 20), total: 20, reward: 60 },
    { name: '目标心率 5 分钟', value: Math.min(Number((daily.zone3Seconds / 60).toFixed(1)), 5), total: 5, reward: 40 },
    { name: '动作评分 ≥ 90', value: daily.hasHighScoreWorkout ? 1 : 0, total: 1, reward: 100 },
  ]
  const statusText = heartRate.status === 'unsupported' ? '浏览器不支持 BLE' : heartRate.status === 'connecting' ? '正在连接…' : heartRate.connected ? (heartRate.deviceName || '心率带已连接') : heartRate.status === 'disconnected' ? '心率带已断开' : heartRate.status === 'error' ? '连接失败，重新连接' : '连接心率带'
  return <div className="page home-page">
    <Header title="动伴" action={<button className="avatar-dot">J</button>}/>
    <section className="greeting"><div><span className="muted">晚上好，</span><h2>{state.nickname}</h2><p>继续运动，让我们变得更好。</p></div><div className="streak"><Icon name="flame" size={15}/> 连续训练 {state.streakDays} 天</div></section>
    <section className="hero-card">
      <div className="speech">更强的<br/>自己！</div>
      <AvatarFigure view="side" />
      <div className="identity"><b>{state.nickname}</b><span>Lv.{state.level}</span></div>
      <div className="xp-row"><div className="progress"><i style={{width:`${state.xp/10}%`}}/></div><small>{state.xp} / 1000 XP</small></div>
      <div className="level-hint">再获 {1000-state.xp} XP 即可升级</div>
    </section>
    <button className="primary start-btn" onClick={start}><Icon name="dumbbell"/>开始训练<Icon name="arrow"/></button>
    <section className="card task-card"><div className="section-title"><b>今日任务</b><span>{tasks.filter(t=>t.value>=t.total).length} / 3 完成</span></div>{tasks.map(t=><div className="task" key={t.name}><div className={t.value>=t.total?'task-check done':'task-check'}>{t.value>=t.total&&<Icon name="check" size={13}/>}</div><div className="task-info"><b>{t.name}</b><div className="task-progress"><i style={{width:`${Math.min(100,t.value/t.total*100)}%`}}/></div></div><small>{t.value}/{t.total}</small><em>+{t.reward} XP</em></div>)}</section>
    <div className="home-grid"><section className="card mini-card heart-card" title={heartRate.errorMessage || undefined}><button className="heart-connect" disabled={heartRate.status==='connecting'||heartRate.status==='unsupported'||heartRate.connected} onClick={heartRate.connect}><span><Icon name="heart" size={17}/> 心率带状态</span><b><i className={`status-dot ${heartRate.status}`}/>{statusText}</b><div className="heart-live">{heartRate.connected && heartRate.signalInterrupted ? <small>心率信号中断</small> : heartRate.connected && heartRate.currentBpm ? <><strong>{heartRate.currentBpm}</strong><small>BPM · Zone {heartRate.currentZone}</small></> : heartRate.connected ? <small>等待心率数据…</small> : <span className="pulse">⌁⌁⌁⌁⌁</span>}</div></button></section><section className="card mini-card"><span><Icon name="flame" size={17}/> 本周运动</span><b>{trainedThisWeek} / 5 天</b><div className="week-bars">{week.map((count,index)=><i key={index} style={{height:Math.min(30,7+count*7)}} className={count>0?'on':''}/>)}</div></section></div>
    {heartRate.status==='unsupported'&&<p className="ble-warning">当前浏览器不支持 Web Bluetooth，请使用桌面 Chrome 或 Edge 演示。</p>}
  </div>
}
