import { useEffect, useRef, useState } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { FormBreakdown, PoseFeedback, PoseIssue, WorkoutMetrics, WorkoutPhase } from '../types'
import { emptyCorrectionCounts, emptyFormBreakdown } from '../lib/sessionMigration'
import { analyzeSquatFrame, type SquatFrameAnalysis } from '../lib/squatMetrics'
import { detectPoseIssues, medianLandmarks } from '../lib/poseFeedback'

export interface SquatMetricsResult extends WorkoutMetrics {
  poseFeedback: PoseFeedback
  formBreakdown: FormBreakdown
  correctionCounts: Record<PoseIssue, number>
  lastRepIssues: PoseIssue[]
  repeatedIssue: PoseIssue | null
}

const uncertainFeedback: PoseFeedback = {
  status: 'uncertain', confidence: 0, issues: ['out_of_frame'], primaryIssue: 'out_of_frame',
  message: '站到画面中央，准备开始', affectedJoints: [11, 12, 23, 24, 25, 26, 27, 28], calibrated: false,
}

const initialMetrics = (targetReps: number): SquatMetricsResult => ({
  reps: 0, targetReps, formScore: 0, perfectReps: 0, feedback: '站到画面中央，准备开始', phase: 'standing',
  poseFeedback: uncertainFeedback, formBreakdown: emptyFormBreakdown(), correctionCounts: emptyCorrectionCounts(), lastRepIssues: [], repeatedIssue: null,
})

const averageBreakdown = (frames: SquatFrameAnalysis[]): FormBreakdown => {
  if (!frames.length) return emptyFormBreakdown()
  const avg = (key: 'depthScore' | 'stabilityScore' | 'trunkScore' | 'symmetryScore') =>
    Math.round(frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length)
  return { depth: avg('depthScore'), stability: avg('stabilityScore'), trunk: avg('trunkScore'), symmetry: avg('symmetryScore') }
}

export function useSquatMetrics(landmarks: NormalizedLandmark[] | null, simulated: boolean, active: boolean, targetReps = 20) {
  const [metrics, setMetrics] = useState<SquatMetricsResult>(() => initialMetrics(targetReps))
  const metricsRef = useRef(metrics)
  const phaseRef = useRef<WorkoutPhase>('standing')
  const reachedBottom = useRef(false)
  const bottomScore = useRef(0)
  const repScores = useRef<number[]>([])
  const repFrames = useRef<SquatFrameAnalysis[]>([])
  const allRepFrames = useRef<SquatFrameAnalysis[]>([])
  const frameHistory = useRef<NormalizedLandmark[][]>([])
  const calibrationStartedAt = useRef(0)
  const calibratedRef = useRef(false)
  const cycleIssues = useRef<Set<PoseIssue>>(new Set())
  const consecutiveIssues = useRef<Partial<Record<PoseIssue, number>>>({})

  useEffect(() => { metricsRef.current = metrics }, [metrics])

  useEffect(() => {
    if (active) return
    setMetrics(initialMetrics(targetReps))
    phaseRef.current = 'standing'
    reachedBottom.current = false
    bottomScore.current = 0
    repScores.current = []
    repFrames.current = []
    allRepFrames.current = []
    frameHistory.current = []
    calibrationStartedAt.current = 0
    calibratedRef.current = false
    cycleIssues.current = new Set()
    consecutiveIssues.current = {}
  }, [active, targetReps])

  useEffect(() => {
    if (!active || simulated) return
    if (landmarks) frameHistory.current = [...frameHistory.current, landmarks].slice(-5)
    const smoothed = medianLandmarks(frameHistory.current)
    const frame = smoothed ? analyzeSquatFrame(smoothed) : null
    if (frame && !calibrationStartedAt.current) calibrationStartedAt.current = performance.now()
    if (frame && !calibratedRef.current && performance.now() - calibrationStartedAt.current >= 2_000) calibratedRef.current = true

    let phase = phaseRef.current
    if (frame) {
      if (frame.kneeAngle <= 102) phase = 'bottom'
      else if (frame.kneeAngle < 150) phase = reachedBottom.current ? 'ascending' : 'descending'
      else if (frame.kneeAngle >= 158) phase = 'standing'
    }

    const poseFeedback = detectPoseIssues(frame, phase, calibratedRef.current)
    if (!frame || !calibratedRef.current) {
      setMetrics(current => ({ ...current, phase, feedback: poseFeedback.message, poseFeedback }))
      return
    }

    if (phase !== 'standing') {
      repFrames.current.push(frame)
      poseFeedback.issues.forEach(issue => cycleIssues.current.add(issue))
    }
    if (phase === 'bottom') {
      reachedBottom.current = true
      bottomScore.current = Math.max(bottomScore.current, frame.formScore)
    }

    if (phase === 'standing' && reachedBottom.current) {
      if (metricsRef.current.reps >= metricsRef.current.targetReps) {
        reachedBottom.current = false
        bottomScore.current = 0
        repFrames.current = []
        cycleIssues.current = new Set()
        phaseRef.current = phase
        setMetrics(current => ({ ...current, phase, poseFeedback, feedback: '已完成目标次数' }))
        return
      }
      const repScore = Math.round(bottomScore.current || frame.formScore)
      repScores.current.push(repScore)
      allRepFrames.current.push(...repFrames.current)
      const completedIssues: PoseIssue[] = [...cycleIssues.current].filter(issue => issue !== 'out_of_frame')
      const nextCounts = { ...metricsRef.current.correctionCounts }
      let repeatedIssue: PoseIssue | null = null
      for (const issue of Object.keys(nextCounts) as PoseIssue[]) {
        const present = completedIssues.includes(issue)
        consecutiveIssues.current[issue] = present ? (consecutiveIssues.current[issue] || 0) + 1 : 0
        if (present) nextCounts[issue] += 1
        if (!repeatedIssue && (consecutiveIssues.current[issue] || 0) >= 2) repeatedIssue = issue
      }
      reachedBottom.current = false
      bottomScore.current = 0
      repFrames.current = []
      cycleIssues.current = new Set()
      const average = Math.round(repScores.current.reduce((sum, score) => sum + score, 0) / repScores.current.length)
      const breakdown = averageBreakdown(allRepFrames.current)
      phaseRef.current = phase
      setMetrics(current => ({
        ...current, reps: Math.min(current.targetReps, current.reps + 1), formScore: average,
        perfectReps: current.perfectReps < current.targetReps ? current.perfectReps + (repScore >= 90 ? 1 : 0) : current.perfectReps,
        feedback: completedIssues.length ? poseFeedback.message : '完成一次，刚才的节奏很稳',
        phase, poseFeedback, formBreakdown: breakdown, correctionCounts: nextCounts,
        lastRepIssues: completedIssues, repeatedIssue,
      }))
      return
    }

    phaseRef.current = phase
    const projectedScore = phase !== 'standing'
      ? Math.round((repScores.current.reduce((sum, score) => sum + score, 0) + frame.formScore) / (repScores.current.length + 1))
      : metricsRef.current.formScore
    setMetrics(current => ({ ...current, formScore: projectedScore, phase, feedback: poseFeedback.message, poseFeedback }))
  }, [landmarks, simulated, active])

  useEffect(() => {
    if (!active || !simulated) return
    let tick = 0
    const timer = window.setInterval(() => {
      tick += 1
      const sequence: WorkoutPhase[] = ['descending', 'bottom', 'ascending', 'standing']
      const phase = sequence[tick % sequence.length]
      const completed = phase === 'standing'
      const poseFeedback: PoseFeedback = { status: 'stable', confidence: 1, issues: [], primaryIssue: null, message: 'Demo · 姿势稳定，保持节奏', affectedJoints: [], calibrated: true }
      setMetrics(current => {
        if (!completed) return { ...current, phase, poseFeedback, feedback: poseFeedback.message }
        if (current.reps >= current.targetReps) return { ...current, phase, poseFeedback, feedback: 'Demo · 已完成目标次数' }
        const nextReps = Math.min(current.targetReps, current.reps + 1)
        const repScore = 86 + (nextReps % 5) * 2
        repScores.current.push(repScore)
        const average = Math.round(repScores.current.reduce((sum, score) => sum + score, 0) / repScores.current.length)
        return {
          ...current, reps: nextReps, formScore: average,
          perfectReps: current.perfectReps + (repScore >= 90 ? 1 : 0), phase, poseFeedback,
          formBreakdown: { depth: 90, stability: 91, trunk: 88, symmetry: 92 },
          lastRepIssues: [], repeatedIssue: null, feedback: 'Demo · 完成一次，节奏保持得很好',
        }
      })
    }, 550)
    return () => clearInterval(timer)
  }, [active, simulated])

  return metrics
}
