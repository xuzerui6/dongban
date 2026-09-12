import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { PoseFeedback, PoseIssue, WorkoutPhase } from '../types'
import type { SquatFrameAnalysis } from './squatMetrics'

export const POSE_ISSUE_COPY: Record<PoseIssue, { label: string; action: string; joints: number[] }> = {
  out_of_frame: { label: '身体未完整入镜', action: '往后站一点，让肩、髋、膝和脚踝都入镜', joints: [11, 12, 23, 24, 25, 26, 27, 28] },
  insufficient_depth: { label: '下蹲深度不足', action: '下一次可以再低一点点，以舒服为准', joints: [23, 24, 25, 26] },
  knee_instability: { label: '膝盖轨迹不稳', action: '膝盖跟着脚尖方向走，脚掌保持贴地', joints: [25, 26, 27, 28] },
  excessive_trunk_lean: { label: '躯干前倾偏多', action: '胸口抬一点，收紧核心再起身', joints: [11, 12, 23, 24] },
  asymmetry: { label: '左右发力不均', action: '重心放回两脚中间，左右一起发力', joints: [23, 24, 25, 26, 27, 28] },
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

/** 五帧中值滤波。遮挡时的偶发跳点不会直接进入计数和矫姿。 */
export function medianLandmarks(frames: NormalizedLandmark[][]): NormalizedLandmark[] | null {
  if (!frames.length) return null
  const count = Math.min(...frames.map(frame => frame.length))
  if (count < 29) return null
  return Array.from({ length: count }, (_, index) => ({
    x: median(frames.map(frame => frame[index].x)),
    y: median(frames.map(frame => frame[index].y)),
    z: median(frames.map(frame => frame[index].z || 0)),
    visibility: median(frames.map(frame => frame[index].visibility ?? 0)),
  }))
}

export function detectPoseIssues(frame: SquatFrameAnalysis | null, phase: WorkoutPhase, calibrated: boolean): PoseFeedback {
  if (!frame) return {
    status: 'uncertain', confidence: 0, issues: ['out_of_frame'], primaryIssue: 'out_of_frame',
    message: calibrated ? POSE_ISSUE_COPY.out_of_frame.action : '站到画面中央，正在校准站姿',
    affectedJoints: POSE_ISSUE_COPY.out_of_frame.joints, calibrated,
  }
  if (!calibrated) return {
    status: 'uncertain', confidence: frame.confidence, issues: [], primaryIssue: null,
    message: '保持自然站姿，校准还剩一点时间', affectedJoints: [], calibrated: false,
  }

  const issues: PoseIssue[] = []
  if ((phase === 'bottom' || phase === 'ascending') && frame.depthScore < 72) issues.push('insufficient_depth')
  if (frame.stabilityScore < 72) issues.push('knee_instability')
  if (frame.trunkScore < 70) issues.push('excessive_trunk_lean')
  if (frame.symmetryScore < 70) issues.push('asymmetry')
  const primaryIssue = issues[0] || null
  return {
    status: primaryIssue ? 'adjust' : 'stable',
    confidence: frame.confidence,
    issues,
    primaryIssue,
    message: primaryIssue ? POSE_ISSUE_COPY[primaryIssue].action : '姿势稳定，保持这个节奏',
    affectedJoints: primaryIssue ? POSE_ISSUE_COPY[primaryIssue].joints : [],
    calibrated: true,
  }
}

export interface CorrectionGateState {
  lastSpokenAt: Partial<Record<PoseIssue, number>>
  consecutive: Partial<Record<PoseIssue, number>>
  activeLastRep: Set<PoseIssue>
}

export const createCorrectionGateState = (): CorrectionGateState => ({ lastSpokenAt: {}, consecutive: {}, activeLastRep: new Set() })

/** 只在完整动作边界决策语音；同类问题 12 秒冷却，改善确认优先。 */
export function decideCorrectionCue(
  issues: PoseIssue[],
  now: number,
  state: CorrectionGateState,
): { text: string; issue: PoseIssue | null; improved: boolean } | null {
  const current = new Set(issues)
  const improved = [...state.activeLastRep].find(issue => !current.has(issue))
  for (const issue of Object.keys(POSE_ISSUE_COPY) as PoseIssue[]) {
    state.consecutive[issue] = current.has(issue) ? (state.consecutive[issue] || 0) + 1 : 0
  }
  state.activeLastRep = current
  if (improved) return { text: `刚才${POSE_ISSUE_COPY[improved].label}已经改善了，就保持这样`, issue: improved, improved: true }
  const issue = issues.find(item => (state.consecutive[item] || 0) >= 2 && now - (state.lastSpokenAt[item] || 0) >= 12_000)
  if (!issue) return null
  state.lastSpokenAt[issue] = now
  return { text: POSE_ISSUE_COPY[issue].action, issue, improved: false }
}
