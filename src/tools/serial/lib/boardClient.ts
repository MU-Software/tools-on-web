// Common abstraction the UI talks to. `HttpBoardClient` and `UsbBoardClient`
// implement the same surface so the UI only sees a transport toggle.

export type Transport = 'http' | 'usb'

export type UsbStats = {
  mounted: boolean
  rxBytes: number
  txBytes: number
  rxDropped: number
}

export type UartConfig = {
  baud: number
  dataBits: number
  parity: 'N' | 'E' | 'O'
  stopBits: number
}

export type UartStats = {
  rxBytes: number
  txBytes: number
}

export type BoardStatus = {
  bootId: number
  uptimeMs: number
  mapCount: number
  stringLen: number
  logAll: boolean
  wifiConnected: boolean
  wifiAp: boolean
  // Only the HTTP transport reports these — the 16-byte control-transfer status
  // struct has no room for them.
  usb?: UsbStats
  uart?: UartConfig & UartStats
}

// Byte pipes. `dir` is from the board's point of view: 'in' = the board
// received these bytes, 'out' = the board sent them.
export type BytePipe = 'usb' | 'uart'
export type ByteDirection = 'in' | 'out'

export type ByteEvent = {
  pipe: BytePipe
  dir: ByteDirection
  data: Uint8Array
  // Device uptime in ms when the record was made; null when the client
  // synthesised the event locally.
  tMs: number | null
}

export type ByteSubscriber = (ev: ByteEvent) => void

// What the connected transport can actually reach. The firmware exposes the
// UART and the log bus over HTTP only — there is no vendor control request for
// either — so the UI has to grey those panels out on a USB connection.
export type BoardCapabilities = {
  log: boolean
  byteStream: boolean
  usbPipe: boolean
  uart: boolean
  ota: boolean
}

export class TransportUnsupportedError extends Error {
  constructor(what: string, transport: Transport) {
    super(
      `${what}은(는) ${transport.toUpperCase()} 전송으로 할 수 없습니다. ` +
        (transport === 'usb'
          ? '펌웨어에 해당 vendor control 요청이 없습니다 — HTTP로 연결하세요.'
          : ''),
    )
    this.name = 'TransportUnsupportedError'
  }
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
  readonly capabilities: BoardCapabilities

  getStatus(): Promise<BoardStatus>
  setLogAll(on: boolean): Promise<void>

  // ---------- byte pipes ----------
  // Push bytes into the board's USB bulk pipe. Over USB this is a direct
  // transferOut; over HTTP the board writes them to its bulk IN endpoint.
  usbTx(data: Uint8Array): Promise<void>
  // Push bytes out of the board's UART (the COM-port side of the board).
  uartTx(data: Uint8Array): Promise<void>
  getUartConfig(): Promise<UartConfig>
  setUartConfig(cfg: UartConfig): Promise<UartConfig>
  subscribeBytes(cb: ByteSubscriber): () => void

  // Firmware image upload. Board reboots into the new image on success.
  otaUpload(image: Uint8Array, sha256Hex?: string): Promise<void>

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

// Firmware log lines are `[<uptime_ms>] <SRC> <payload>` (log_bus.c). The four
// byte-pipe sources render their payload as hex; every other source writes
// free text, so this returns null for them.
const BYTE_SOURCES: Record<string, { pipe: BytePipe; dir: ByteDirection }> = {
  USB_IN: { pipe: 'usb', dir: 'in' },
  USB_OUT: { pipe: 'usb', dir: 'out' },
  UART_IN: { pipe: 'uart', dir: 'in' },
  UART_OUT: { pipe: 'uart', dir: 'out' },
}

export function parseByteLogLine(line: string): ByteEvent | null {
  const m = /^\[(\d+)\]\s+(\w+)\s+([0-9a-fA-F]*)\s*$/.exec(line.trim())
  if (!m) return null
  const src = BYTE_SOURCES[m[2]]
  if (!src) return null
  const hex = m[3]
  if (hex.length % 2 !== 0) return null
  return { ...src, data: hexToBytes(hex), tMs: Number(m[1]) }
}
