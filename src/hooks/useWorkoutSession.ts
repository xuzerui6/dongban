import { useEffect, useRef, useState } from 'react'
import { emptyZoneDurations, incrementZone } from '../lib/heartRate'
import type { HeartRateZone, WorkoutMetrics, WorkoutSession } from '../types'

interface HeartRateSnapshot {
  connected: boolean
  currentBpm: number | null
  currentZone: HeartRateZone | null
  lastPacketAt: number | null
  packetCount: number
  signalInterrupted: boolean
}
const newId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `workout-${Date.now()}`

export function useWorkoutSession(metrics: WorkoutMetrics, heartRate: HeartRateSnapshot, running: boolean, paused: boolean) {
  const [session, setSession] = useState<WorkoutSession | null>(null)
  const sessionRef = useRef<WorkoutSession | null>(null)
  const metricsRef = useRef(metrics)
  const heartRateRef = useRef(heartRate)
  const heartSamples = useRef({ count: 0, total: 0, max: 0 })
  const startPacketCount = useRef(0)
  const previousPacket = useRef<{ timestamp: number; zone: HeartRateZone | null } | null>(null)

  useEffect(() => { metricsRef.current = metrics }, [metrics])
  useEffect(() => { heartRateRef.current = heartRate }, [heartRate])

  useEffect(() => {
    if (!running || sessionRef.current) return
    startPacketCount.current = heartRate.packetCount
    heartSamples.current = { count: 0, total: 0, max: 0 }
    previousPacket.current = null
    const started: WorkoutSession = {
      id: newId(), exerciseType: 'squat', startTime: new Date().toISOString(), endTime: null, durationSeconds: 0,
      ...metrics, currentBpm: null, averageBpm: null, maxBpm: null, heartRateSource: null,
      ...emptyZoneDurations(), xpEarned: 0, unlocked: [],
    }
    sessionRef.current = started; setSession(started)
  }, [running])

  useEffect(() => {
    if (!sessionRef.current || sessionRef.current.endTime) return
    const next = { ...sessionRef.current, ...metrics }
    sessionRef.current = next; setSession(next)
  }, [metrics])

  useEffect(() => {
    if (!running || paused || !sessionRef.current || !heartRate.connected || heartRate.packetCount <= startPacketCount.current || !heartRate.lastPacketAt || !heartRate.currentBpm) return
    const samples = heartSamples.current
    samples.count += 1; samples.total += heartRate.currentBpm; samples.max = Math.max(samples.max, heartRate.currentBpm)
    let zones = emptyZoneDurations()
    const previous = previousPacket.current
    if (previous) {
      const seconds = Math.min(5, Math.max(0, (heartRate.lastPacketAt - previous.timestamp) / 1000))
      zones = incrementZone(sessionRef.current, previous.zone, seconds)
    } else {
      zones = incrementZone(sessionRef.current, null, 0)
    }
    previousPacket.current = { timestamp: heartRate.lastPacketAt, zone: heartRate.currentZone }
    const next: WorkoutSession = {
      ...sessionRef.current, ...zones, currentBpm: heartRate.currentBpm,
      averageBpm: Math.round(samples.total / samples.count), maxBpm: samples.max, heartRateSource: 'ble',
    }
    sessionRef.current = next; setSession(next)
  }, [running, paused, heartRate.packetCount])

  useEffect(() => {
    if (!running || paused) return
    const timer = window.setInterval(() => {
      const current = sessionRef.current
      if (!current || current.endTime) return
      const next = { ...current, durationSeconds: current.durationSeconds + 1 }
      sessionRef.current = next; setSession(next)
    }, 1000)
    return () => clearInterval(timer)
  }, [running, paused])

  useEffect(() => {
    if (!sessionRef.current || heartRate.connected) return
    const next = { ...sessionRef.current, currentBpm: null }
    sessionRef.current = next; setSession(next)
  }, [heartRate.connected])

  useEffect(() => {
    if (!paused) return
    startPacketCount.current = heartRate.packetCount
    previousPacket.current = null
  }, [paused, heartRate.packetCount])

  const finish = () => {
    const current = sessionRef.current
    if (!current) return null
    const liveHeart = heartRateRef.current
    const finished: WorkoutSession = {
      ...current, ...metricsRef.current, endTime: new Date().toISOString(),
      currentBpm: liveHeart.connected && !liveHeart.signalInterrupted ? current.currentBpm : null,
    }
    sessionRef.current = finished; setSession(finished)
    return finished
  }
  return { session, finish }
}
