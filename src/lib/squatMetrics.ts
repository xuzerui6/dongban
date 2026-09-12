import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export interface SquatFrameAnalysis {
  kneeAngle: number
  depthScore: number
  stabilityScore: number
  trunkScore: number
  symmetryScore: number
  formScore: number
  confidence: number
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))
const angle = (a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) => {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let degrees = Math.abs(radians * 180 / Math.PI)
  if (degrees > 180) degrees = 360 - degrees
  return degrees
}
const distance = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2, visibility: Math.min(a.visibility || 1, b.visibility || 1) })

export function analyzeSquatFrame(points: NormalizedLandmark[]): SquatFrameAnalysis | null {
  if (points.length < 29) return null
  const required = [11, 12, 23, 24, 25, 26, 27, 28]
  const confidence = Math.min(...required.map(index => points[index].visibility ?? 0))
  if (confidence < .55) return null
  if (required.some(index => points[index].x < .035 || points[index].x > .965 || points[index].y < .025 || points[index].y > .985)) return null
  const leftKnee = angle(points[23], points[25], points[27])
  const rightKnee = angle(points[24], points[26], points[28])
  const kneeAngle = (leftKnee + rightKnee) / 2
  const depthScore = clamp((125 - kneeAngle) / 35 * 100)
  const symmetryScore = clamp(100 - Math.abs(leftKnee - rightKnee) * 2.5)
  const shoulderWidth = Math.max(.05, distance(points[11], points[12]))
  const kneeDrift = (Math.abs(points[25].x - points[27].x) + Math.abs(points[26].x - points[28].x)) / (2 * shoulderWidth)
  const stabilityScore = clamp(100 - Math.max(0, kneeDrift - .3) * 130)
  const shoulderMid = midpoint(points[11], points[12]), hipMid = midpoint(points[23], points[24])
  const trunkTilt = Math.abs(Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180 / Math.PI)
  const trunkScore = clamp(100 - Math.max(0, trunkTilt - 10) * 3.5)
  const formScore = Math.round(depthScore * .35 + stabilityScore * .25 + trunkScore * .20 + symmetryScore * .20)
  return { kneeAngle, depthScore, stabilityScore, trunkScore, symmetryScore, formScore, confidence }
}
