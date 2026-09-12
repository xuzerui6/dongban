import { useEffect, useRef, useState } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { WorkoutMetrics, WorkoutPhase } from '../types'
import { analyzeSquatFrame } from '../lib/squatMetrics'

const initialMetrics = (targetReps: number): WorkoutMetrics => ({ reps: 0, targetReps, formScore: 0, perfectReps: 0, feedback: '站到画面中央，准备开始', phase: 'standing' })

export function useSquatMetrics(landmarks: NormalizedLandmark[] | null, simulated: boolean, active: boolean, targetReps = 20) {
  const [metrics, setMetrics] = useState<WorkoutMetrics>(() => initialMetrics(targetReps))
  const phaseRef = useRef<WorkoutPhase>('standing')
  const reachedBottom = useRef(false)
  const bottomScore = useRef(0)
  const repScores = useRef<number[]>([])

  useEffect(() => {
    if (!active || simulated) return
    const frame = landmarks ? analyzeSquatFrame(landmarks) : null
    if (!frame) { setMetrics(current => ({ ...current, feedback: '请保持肩、髋、膝、踝进入画面' })); return }
    let phase: WorkoutPhase = phaseRef.current
    let feedback = '保持稳定，继续动作'
    if (frame.kneeAngle < 100) {
      phase = 'bottom'; reachedBottom.current = true; bottomScore.current = Math.max(bottomScore.current, frame.formScore)
      feedback = frame.depthScore >= 90 ? '深度达标，稳住核心' : '再蹲低一点'
    } else if (frame.kneeAngle < 145) {
      phase = reachedBottom.current ? 'ascending' : 'descending'
      feedback = frame.stabilityScore < 75 ? '保持膝盖与脚尖方向一致' : frame.trunkScore < 75 ? '抬起胸口，保持躯干稳定' : phase === 'ascending' ? '向上发力' : '控制速度，继续下蹲'
    } else if (frame.kneeAngle > 158) {
      phase = 'standing'
      if (reachedBottom.current) {
        const repScore = Math.round(bottomScore.current || frame.formScore)
        repScores.current.push(repScore)
        reachedBottom.current = false; bottomScore.current = 0
        const average = Math.round(repScores.current.reduce((sum, score) => sum + score, 0) / repScores.current.length)
        setMetrics(current => ({ ...current, reps: current.reps + 1, formScore: average, perfectReps: current.perfectReps + (repScore >= 90 ? 1 : 0), feedback: repScore >= 90 ? '完成一次，动作很标准！' : '完成一次，下一次保持稳定', phase }))
        phaseRef.current = phase
        return
      }
      feedback = '站稳，准备下一次深蹲'
    }
    phaseRef.current = phase
    setMetrics(current => {
      const projectedScore = phase !== 'standing'
        ? Math.round((repScores.current.reduce((sum, score) => sum + score, 0) + frame.formScore) / (repScores.current.length + 1))
        : current.formScore
      return { ...current, formScore: projectedScore, phase, feedback }
    })
  }, [landmarks, simulated, active])

  useEffect(() => {
    if (!active || !simulated) return
    let tick = 0
    const timer = window.setInterval(() => {
      tick += 1
      const sequence: WorkoutPhase[] = ['descending', 'bottom', 'ascending', 'standing']
      const phase = sequence[tick % sequence.length]
      const completed = phase === 'standing'
      setMetrics(current => {
        if (!completed) return { ...current, phase, feedback: phase === 'bottom' ? 'Demo · 深度达标' : phase === 'ascending' ? 'Demo · 向上发力' : 'Demo · 控制下蹲速度' }
        const nextReps = current.reps + 1
        const repScore = 86 + (nextReps % 5) * 2
        repScores.current.push(repScore)
        const average = Math.round(repScores.current.reduce((sum, score) => sum + score, 0) / repScores.current.length)
        return { ...current, reps: nextReps, formScore: average, perfectReps: current.perfectReps + (repScore >= 90 ? 1 : 0), phase, feedback: 'Demo · 完成一次，保持节奏' }
      })
    }, 550)
    return () => clearInterval(timer)
  }, [active, simulated])

  return metrics
}
