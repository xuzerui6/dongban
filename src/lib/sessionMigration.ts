import type { FormBreakdown, PoseIssue, WorkoutSession } from '../types'

export const emptyFormBreakdown = (): FormBreakdown => ({ depth: 0, stability: 0, trunk: 0, symmetry: 0 })
export const emptyCorrectionCounts = (): Record<PoseIssue, number> => ({
  out_of_frame: 0, insufficient_depth: 0, knee_instability: 0, excessive_trunk_lean: 0, asymmetry: 0,
})

/** 旧版本训练记录没有视觉和对话字段，加载时补空值而不丢历史。 */
export function migrateWorkoutSession(session: WorkoutSession): WorkoutSession {
  return {
    ...session,
    formBreakdown: { ...emptyFormBreakdown(), ...(session.formBreakdown || {}) },
    correctionCounts: { ...emptyCorrectionCounts(), ...(session.correctionCounts || {}) },
    visionInsights: Array.isArray(session.visionInsights) ? session.visionInsights : [],
    conversationTurnCount: Number.isFinite(session.conversationTurnCount) ? session.conversationTurnCount : 0,
  }
}
