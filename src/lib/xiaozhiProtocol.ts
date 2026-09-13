import type { CoachEmotion, McpTextResult, XiaozhiEnvelope } from '../types'

export const XIAOZHI_AUDIO = { format: 'opus', sample_rate: 16_000, channels: 1, frame_duration: 60 } as const

export const helloMessage = () => ({
  type: 'hello', version: 1, features: { mcp: true }, transport: 'websocket', audio_params: XIAOZHI_AUDIO,
})

const session = <T extends Record<string, unknown>>(message: T, sessionId?: string): T & { session_id?: string } => (
  sessionId ? { ...message, session_id: sessionId } : message
)

export const listenMessage = (state: 'start' | 'stop' | 'detect', sessionId?: string, text?: string): XiaozhiEnvelope => {
  if (state === 'start') return session({ type: 'listen', state, mode: 'auto' }, sessionId)
  if (state === 'detect') return session({ type: 'listen', state, text: text || '你好动伴' }, sessionId)
  return session({ type: 'listen', state }, sessionId)
}
export const abortMessage = (reason = 'user_interrupt', sessionId?: string): XiaozhiEnvelope => session({ type: 'abort', reason }, sessionId)
export const mcpResult = (id: string | number, result: unknown, sessionId?: string): XiaozhiEnvelope => session({
  type: 'mcp', payload: { jsonrpc: '2.0', id, result },
}, sessionId)
export const mcpTextResult = (id: string | number, value: unknown, sessionId?: string, isError = false): XiaozhiEnvelope => {
  const result: McpTextResult = {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    isError,
  }
  return mcpResult(id, result, sessionId)
}
export const mcpError = (id: string | number, message: string, sessionId?: string): XiaozhiEnvelope => session({
  type: 'mcp', payload: { jsonrpc: '2.0', id, error: { code: -32000, message } },
}, sessionId)
export const mcpNotification = (method: string, params: unknown, sessionId?: string): XiaozhiEnvelope => session({
  type: 'mcp', payload: { jsonrpc: '2.0', method, params },
}, sessionId)

const EMOTIONS: Record<string, CoachEmotion> = {
  neutral: 'neutral', listening: 'listening', thinking: 'thinking', happy: 'happy', laughing: 'happy',
  confident: 'confident', proud: 'confident', caring: 'caring', sad: 'caring', concerned: 'concerned',
  worried: 'concerned', surprised: 'happy', celebrating: 'celebrating', excited: 'celebrating',
}
export const mapXiaozhiEmotion = (emotion?: string): CoachEmotion => EMOTIONS[(emotion || '').toLowerCase()] || 'neutral'

export function hasOpusWebCodecs(scope: typeof globalThis = globalThis): boolean {
  return typeof (scope as unknown as { AudioEncoder?: unknown }).AudioEncoder !== 'undefined' && typeof (scope as unknown as { AudioDecoder?: unknown }).AudioDecoder !== 'undefined'
}
