// Common abstraction the UI talks to. `HttpBoardClient` and `UsbBoardClient`
// implement the same surface so the UI only sees a transport toggle.

export type Transport = 'http' | 'usb'

export type BoardStatus = {
  bootId: number
  uptimeMs: number
  mapCount: number
  stringLen: number
  logAll: boolean
  wifiConnected: boolean
  wifiAp: boolean
}

export type MapEntry = {
  key: string
  value: Uint8Array
}

export type WifiCred = {
  ssid: string
  password: string
}

export type LogSubscriber = (line: string) => void

export interface BoardClient {
  readonly transport: Transport

  getStatus(): Promise<BoardStatus>
  setLogAll(on: boolean): Promise<void>

  getString(): Promise<Uint8Array>
  setString(data: Uint8Array): Promise<void>

  getMap(): Promise<MapEntry[]>
  putMap(entries: MapEntry[]): Promise<void>

  getWifi(): Promise<WifiCred[]>
  putWifi(creds: WifiCred[]): Promise<void>

  echo(data: Uint8Array): Promise<void>
  reboot(): Promise<void>

  getLogSnapshot(): Promise<string>
  subscribeLog(cb: LogSubscriber): () => void

  dispose(): Promise<void>
}

// ---------- shared helpers ----------

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length % 2 !== 0) throw new Error('hex 길이가 짝수가 아닙니다')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function bytesToUtf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}
