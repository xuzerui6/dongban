import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getHeartRateZone } from '../lib/heartRate'
import { bleHeartRateService, type BleConnectionStatus } from '../services/bleHeartRate'

interface HeartRateContextValue {
  connected: boolean
  deviceName: string | null
  currentBpm: number | null
  averageBpm: number | null
  maxBpm: number | null
  lastPacketAt: number | null
  packetCount: number
  status: BleConnectionStatus
  signalInterrupted: boolean
  errorMessage: string | null
  connect: () => Promise<void>
}
const HeartRateContext = createContext<HeartRateContextValue | null>(null)

export function HeartRateProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [currentBpm, setCurrentBpm] = useState<number | null>(null)
  const [averageBpm, setAverageBpm] = useState<number | null>(null)
  const [maxBpm, setMaxBpm] = useState<number | null>(null)
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null)
  const [packetCount, setPacketCount] = useState(0)
  const [status, setStatus] = useState<BleConnectionStatus>(() => bleHeartRateService.isSupported() ? 'idle' : 'unsupported')
  const [signalInterrupted, setSignalInterrupted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const samples = useRef({ count: 0, total: 0, max: 0 })
  const signalTimer = useRef<number | null>(null)

  useEffect(() => {
    const offReading = bleHeartRateService.onReading(packet => {
      const next = samples.current
      next.count += 1; next.total += packet.bpm; next.max = Math.max(next.max, packet.bpm)
      setCurrentBpm(packet.bpm)
      setAverageBpm(Math.round(next.total / next.count))
      setMaxBpm(next.max)
      setLastPacketAt(packet.timestamp)
      setPacketCount(packet.packetCount)
      setSignalInterrupted(false)
      if (signalTimer.current !== null) window.clearTimeout(signalTimer.current)
      signalTimer.current = window.setTimeout(() => setSignalInterrupted(true), 5000)
    })
    const offStatus = bleHeartRateService.onStatus((nextStatus, name, message) => {
      setStatus(nextStatus); setDeviceName(name); setErrorMessage(message || null)
      if (nextStatus === 'connecting') {
        samples.current = { count: 0, total: 0, max: 0 }
        setConnected(false); setCurrentBpm(null); setAverageBpm(null); setMaxBpm(null); setLastPacketAt(null); setPacketCount(0); setSignalInterrupted(false)
      }
      if (nextStatus === 'connected') { setConnected(true); setCurrentBpm(null); setLastPacketAt(null); setSignalInterrupted(false) }
      if (nextStatus === 'disconnected') {
        setConnected(false); setCurrentBpm(null); setLastPacketAt(null); setSignalInterrupted(false)
        if (signalTimer.current !== null) window.clearTimeout(signalTimer.current)
      }
    })
    return () => {
      offReading(); offStatus()
      if (signalTimer.current !== null) window.clearTimeout(signalTimer.current)
    }
  }, [])

  const connect = async () => { if (!connected) await bleHeartRateService.connect() }
  return <HeartRateContext.Provider value={{ connected, deviceName, currentBpm, averageBpm, maxBpm, lastPacketAt, packetCount, status, signalInterrupted, errorMessage, connect }}>{children}</HeartRateContext.Provider>
}

export function useHeartRateMonitor(age: number) {
  const monitor = useContext(HeartRateContext)
  if (!monitor) throw new Error('HeartRateProvider missing')
  return useMemo(() => ({
    ...monitor,
    currentZone: monitor.connected && !monitor.signalInterrupted ? getHeartRateZone(monitor.currentBpm, age) : null,
  }), [monitor, age])
}
