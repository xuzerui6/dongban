export const HEART_RATE_SERVICE = 0x180d
export const HEART_RATE_MEASUREMENT = 0x2a37

export type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'unsupported' | 'error'
export interface HeartRatePacket { bpm: number; timestamp: number; raw: number[]; packetCount: number }

type BluetoothDeviceLike = {
  name?: string
  gatt?: { connect: () => Promise<{ getPrimaryService: (service: number) => Promise<{ getCharacteristic: (characteristic: number) => Promise<CharacteristicLike> }> }> }
  addEventListener: (name: string, handler: () => void) => void
}
type CharacteristicLike = {
  value?: DataView | null
  startNotifications: () => Promise<CharacteristicLike>
  addEventListener: (name: string, handler: (event: Event) => void) => void
  removeEventListener?: (name: string, handler: (event: Event) => void) => void
}
type BluetoothNavigator = Navigator & { bluetooth?: { requestDevice: (options: { filters: Array<{ services: number[] }> }) => Promise<BluetoothDeviceLike> } }

export function parseHeartRateMeasurement(value: DataView): number {
  if (value.byteLength < 2) throw new Error('Heart Rate Measurement 数据长度不足')
  const flags = value.getUint8(0)
  if ((flags & 0x01) === 0x01) {
    if (value.byteLength < 3) throw new Error('uint16 Heart Rate Measurement 数据长度不足')
    return value.getUint16(1, true)
  }
  return value.getUint8(1)
}

export class BleHeartRateService {
  private device: BluetoothDeviceLike | null = null
  private characteristic: CharacteristicLike | null = null
  private readingListeners = new Set<(packet: HeartRatePacket) => void>()
  private statusListeners = new Set<(status: BleConnectionStatus, deviceName: string | null, message?: string) => void>()
  private packetCount = 0

  isSupported() { return typeof navigator !== 'undefined' && Boolean((navigator as BluetoothNavigator).bluetooth) }
  onReading(listener: (packet: HeartRatePacket) => void) { this.readingListeners.add(listener); return () => { this.readingListeners.delete(listener) } }
  onStatus(listener: (status: BleConnectionStatus, deviceName: string | null, message?: string) => void) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener) } }
  private emitStatus(status: BleConnectionStatus, message?: string) { this.statusListeners.forEach(listener => listener(status, this.device?.name || null, message)) }
  private handleMeasurement = (event: Event) => {
    const value = (event.target as CharacteristicLike | null)?.value
    if (!value) return
    try {
      const bpm = parseHeartRateMeasurement(value)
      if (bpm > 0 && bpm < 260) {
        this.packetCount += 1
        const packet: HeartRatePacket = {
          bpm, timestamp: Date.now(), packetCount: this.packetCount,
          raw: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
        }
        if (import.meta.env.DEV) console.debug('[BLE HEART RATE]', { device: this.device?.name || null, packetCount: packet.packetCount, bpm: packet.bpm, timestamp: packet.timestamp, raw: packet.raw })
        this.readingListeners.forEach(listener => listener(packet))
      }
    } catch (error) { this.emitStatus('error', error instanceof Error ? error.message : '无法解析心率数据') }
  }
  private handleDisconnected = () => { this.characteristic?.removeEventListener?.('characteristicvaluechanged', this.handleMeasurement); this.characteristic = null; this.emitStatus('disconnected') }

  async connect() {
    if (this.characteristic) { this.emitStatus('connected'); return }
    if (!this.isSupported()) { this.emitStatus('unsupported', '当前浏览器不支持 Web Bluetooth，请使用桌面 Chrome 或 Edge 演示。'); return }
    this.emitStatus('connecting')
    try {
      const bluetooth = (navigator as BluetoothNavigator).bluetooth!
      this.device = await bluetooth.requestDevice({ filters: [{ services: [HEART_RATE_SERVICE] }] })
      this.packetCount = 0
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnected)
      if (!this.device.gatt) throw new Error('设备不支持 GATT 连接')
      const server = await this.device.gatt.connect()
      const service = await server.getPrimaryService(HEART_RATE_SERVICE)
      this.characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT)
      await this.characteristic.startNotifications()
      this.characteristic.addEventListener('characteristicvaluechanged', this.handleMeasurement)
      this.emitStatus('connected')
    } catch (error) {
      const message = error instanceof Error && error.name === 'NotFoundError' ? '未选择心率设备' : error instanceof Error ? error.message : '心率带连接失败'
      this.emitStatus('error', message)
    }
  }
}

export const bleHeartRateService = new BleHeartRateService()
