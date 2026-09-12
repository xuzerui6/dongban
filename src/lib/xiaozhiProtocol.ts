import type { CoachEmotion } from '../types'

export const XIAOZHI_AUDIO = { format: 'opus', sample_rate: 16_000, channels: 1, frame_duration: 60 } as const

export const helloMessage = () => ({
  type: 'hello', version: 1, features: { mcp: true }, transport: 'websocket', audio_params: XIAOZHI_AUDIO,
})
export const listenMessage = (state: 'start' | 'stop') => state === 'start'
  ? { type: 'listen', state, mode: 'auto' }
  : { type: 'listen', state }
export const abortMessage = (reason = 'user_interrupt') => ({ type: 'abort', reason })
export const mcpResult = (id: string | number, result: unknown) => ({ type: 'mcp', payload: { jsonrpc: '2.0', id, result } })
export const mcpError = (id: string | number, message: string) => ({ type: 'mcp', payload: { jsonrpc: '2.0', id, error: { code: -32000, message } } })

const EMOTIONS: Record<string, CoachEmotion> = {
  neutral: 'neutral', listening: 'listening', thinking: 'thinking', happy: 'happy', laughing: 'happy',
  confident: 'confident', proud: 'confident', caring: 'caring', sad: 'caring', concerned: 'concerned',
  worried: 'concerned', surprised: 'happy', celebrating: 'celebrating', excited: 'celebrating',
}
export const mapXiaozhiEmotion = (emotion?: string): CoachEmotion => EMOTIONS[(emotion || '').toLowerCase()] || 'neutral'

export function hasOpusWebCodecs(scope: typeof globalThis = globalThis): boolean {
  return typeof (scope as unknown as { AudioEncoder?: unknown }).AudioEncoder !== 'undefined' && typeof (scope as unknown as { AudioDecoder?: unknown }).AudioDecoder !== 'undefined'
}
