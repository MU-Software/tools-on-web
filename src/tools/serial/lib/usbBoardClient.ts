import {
  type BoardCapabilities,
  type BoardClient,
  type BoardStatus,
  type ByteSubscriber,
  type MapEntry,
  type UartConfig,
  type WifiCred,
  TransportUnsupportedError,
} from './boardClient'

// Mirrors enum in board_serial_tester/main/control_proto.h. Keep in sync.
const CTRL = {
  ECHO: 0x10,
  STR_SET: 0x20,
  STR_GET: 0x21,
  STR_GET_AT: 0x22,
  STR_PUT_CHUNK: 0x23,
  MAP_PUT: 0x30,
  MAP_DEL: 0x31,
  MAP_GET_PREP: 0x32,
  MAP_GET_FETCH: 0x33,
  MAP_LIST_PREP: 0x34,
  MAP_LIST_AT: 0x35,
  WIFI_ADD: 0x40,
  WIFI_DEL: 0x41,
  WIFI_LIST: 0x42,
  WIFI_LIST_FULL: 0x43,
  LOG_ALL_SET: 0x60,
  STATUS: 0x70,
  REBOOT: 0x71,
} as const

const CTRL_CHUNK = 2048   // safe sub-APP_CTRL_PAYLOAD_MAX (4096)

const STATUS_LEN = 16

export type UsbBoardClientOptions = {
  device: USBDevice
  // Claimed interface used for control transfer routing. wIndex's low byte is
  // set to this value so Chromium will deliver the transfer (otherwise macOS
  // rejects recipient=device transfers even for vendor-class devices).
  interfaceNumber: number
  // Vendor bulk byte pipe (usb_iface.c). IN carries whatever the board pushed
  // with usb_iface_write(); OUT delivers our bytes to the board, which logs
  // them as USB_IN. These are raw bytes — NOT the log bus, which the firmware
  // only exposes over HTTP/WebSocket.
  pipeInEndpoint?: number | null
  pipeOutEndpoint?: number | null
  pipePacketSize?: number
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return buf
}

export class UsbBoardClient implements BoardClient {
  readonly transport = 'usb' as const
  readonly capabilities: BoardCapabilities
  private readonly device: USBDevice
  private readonly interfaceNumber: number
  private readonly pipeInEndpoint: number | null
  private readonly pipeOutEndpoint: number | null
  private readonly pipePacketSize: number

  private byteSubscribers = new Set<ByteSubscriber>()
  private readToken: { stop: boolean } | null = null

  constructor(opts: UsbBoardClientOptions) {
    this.device = opts.device
    this.interfaceNumber = opts.interfaceNumber
    this.pipeInEndpoint = opts.pipeInEndpoint ?? null
    this.pipeOutEndpoint = opts.pipeOutEndpoint ?? null
    this.pipePacketSize = opts.pipePacketSize ?? 64
    this.capabilities = {
      // control_proto.h has no request for the log bus, the UART or OTA — those
      // live on the HTTP server only.
      log: false,
      byteStream: this.pipeInEndpoint !== null || this.pipeOutEndpoint !== null,
      usbPipe: this.pipeOutEndpoint !== null,
      uart: false,
      ota: false,
    }
  }

  // ---------- raw control transfer helpers ----------
  // wIndex packing:
  //   bits 0..7  = interface number (Chromium routes the transfer here)
  //   bits 8..15 = per-request flag bits (e.g. STR_PUT_CHUNK commit)

  private packIndex(flags: number): number {
    return ((flags & 0xff) << 8) | (this.interfaceNumber & 0xff)
  }

  private async controlOut(
    request: number,
    wValue: number,
    flags: number,
    data?: Uint8Array,
  ): Promise<void> {
    const setup: USBControlTransferParameters = {
      requestType: 'vendor',
      recipient: 'interface',
      request,
      value: wValue,
      index: this.packIndex(flags),
    }
    const result = data
      ? await this.device.controlTransferOut(setup, toArrayBuffer(data))
      : await this.device.controlTransferOut(setup)
    if (result.status !== 'ok') {
      throw new Error(`control OUT 0x${request.toString(16)} ${result.status}`)
    }
  }

  private async controlIn(
    request: number,
    wValue: number,
    flags: number,
    length: number,
  ): Promise<Uint8Array> {
    const setup: USBControlTransferParameters = {
      requestType: 'vendor',
      recipient: 'interface',
      request,
      value: wValue,
      index: this.packIndex(flags),
    }
    const result = await this.device.controlTransferIn(setup, length)
    if (result.status !== 'ok') {
      throw new Error(`control IN 0x${request.toString(16)} ${result.status}`)
    }
    if (!result.data) return new Uint8Array(0)
    return new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    )
  }

  // ---------- BoardClient surface ----------

  async getStatus(): Promise<BoardStatus> {
    const bytes = await this.controlIn(CTRL.STATUS, 0, 0, STATUS_LEN)
    if (bytes.byteLength < STATUS_LEN) {
      throw new Error(`status: short read ${bytes.byteLength}`)
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      bootId: dv.getUint32(0, true),
      uptimeMs: dv.getUint32(4, true),
      mapCount: dv.getUint16(8, true),
      stringLen: dv.getUint16(10, true),
      logAll: dv.getUint8(12) !== 0,
      wifiConnected: dv.getUint8(13) !== 0,
      wifiAp: dv.getUint8(14) !== 0,
    }
  }

  async setLogAll(on: boolean): Promise<void> {
    await this.controlOut(CTRL.LOG_ALL_SET, on ? 1 : 0, 0)
  }

  async getString(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    let offset = 0
    while (true) {
      const chunk = await this.controlIn(CTRL.STR_GET_AT, offset, 0, CTRL_CHUNK)
      if (chunk.byteLength === 0) break
      chunks.push(chunk)
      offset += chunk.byteLength
      if (chunk.byteLength < CTRL_CHUNK) break
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.byteLength
    }
    return out
  }

  async setString(data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) {
      // commit empty: offset=0, commit flag set
      await this.controlOut(CTRL.STR_PUT_CHUNK, 0, 1)
      return
    }
    let offset = 0
    while (offset < data.byteLength) {
      const end = Math.min(offset + CTRL_CHUNK, data.byteLength)
      const isFinal = end === data.byteLength
      const chunk = data.subarray(offset, end)
      await this.controlOut(CTRL.STR_PUT_CHUNK, offset, isFinal ? 1 : 0, chunk)
      offset = end
    }
  }

  async getMap(): Promise<MapEntry[]> {
    await this.controlOut(CTRL.MAP_LIST_PREP, 0, 0)
    const buf: Uint8Array[] = []
    let offset = 0
    // wIndex is u16 — bound by 64KB. The firmware snapshot can exceed this if
    // large maps are used, so fail fast if we'd overflow.
    while (true) {
      if (offset > 0xffff) {
        throw new Error('map snapshot exceeds 64KB; use HTTP transport')
      }
      const chunk = await this.controlIn(CTRL.MAP_LIST_AT, offset, 0, CTRL_CHUNK)
      if (chunk.byteLength === 0) break
      buf.push(chunk)
      offset += chunk.byteLength
      if (chunk.byteLength < CTRL_CHUNK) break
    }
    return parseMapTlv(concat(buf))
  }

  async putMap(entries: MapEntry[]): Promise<void> {
    // Get current keys and diff so we don't churn unchanged ones.
    const existing = await this.getMap()
    const newKeys = new Set(entries.map((e) => e.key))
    for (const e of existing) {
      if (!newKeys.has(e.key)) await this.mapDel(e.key)
    }
    for (const e of entries) {
      await this.mapPut(e.key, e.value)
    }
  }

  private async mapPut(key: string, value: Uint8Array): Promise<void> {
    const keyBytes = new TextEncoder().encode(key)
    if (keyBytes.byteLength === 0) throw new Error('map key empty')
    const body = new Uint8Array(2 + keyBytes.byteLength + 2 + value.byteLength)
    const dv = new DataView(body.buffer)
    dv.setUint16(0, keyBytes.byteLength, true)
    body.set(keyBytes, 2)
    dv.setUint16(2 + keyBytes.byteLength, value.byteLength, true)
    body.set(value, 2 + keyBytes.byteLength + 2)
    await this.controlOut(CTRL.MAP_PUT, 0, 0, body)
  }

  private async mapDel(key: string): Promise<void> {
    const keyBytes = new TextEncoder().encode(key)
    const body = new Uint8Array(2 + keyBytes.byteLength)
    const dv = new DataView(body.buffer)
    dv.setUint16(0, keyBytes.byteLength, true)
    body.set(keyBytes, 2)
    await this.controlOut(CTRL.MAP_DEL, 0, 0, body)
  }

  async getWifi(): Promise<WifiCred[]> {
    const bytes = await this.controlIn(CTRL.WIFI_LIST_FULL, 0, 0, CTRL_CHUNK)
    return parseWifiTlv(bytes)
  }

  async putWifi(creds: WifiCred[]): Promise<void> {
    const existing = await this.getWifi()
    const wanted = new Map(creds.map((c) => [c.ssid, c.password]))
    for (const e of existing) {
      const wantedPw = wanted.get(e.ssid)
      if (wantedPw === undefined) {
        await this.wifiDel(e.ssid)
      }
    }
    for (const c of creds) {
      await this.wifiAdd(c.ssid, c.password)
    }
  }

  private async wifiAdd(ssid: string, password: string): Promise<void> {
    const ssidBytes = new TextEncoder().encode(ssid)
    const passBytes = new TextEncoder().encode(password)
    if (ssidBytes.byteLength > 32 || passBytes.byteLength > 64) {
      throw new Error('wifi: ssid/password too long')
    }
    const body = new Uint8Array(1 + ssidBytes.byteLength + 1 + passBytes.byteLength)
    body[0] = ssidBytes.byteLength
    body.set(ssidBytes, 1)
    body[1 + ssidBytes.byteLength] = passBytes.byteLength
    body.set(passBytes, 1 + ssidBytes.byteLength + 1)
    await this.controlOut(CTRL.WIFI_ADD, 0, 0, body)
  }

  private async wifiDel(ssid: string): Promise<void> {
    const ssidBytes = new TextEncoder().encode(ssid)
    const body = new Uint8Array(1 + ssidBytes.byteLength)
    body[0] = ssidBytes.byteLength
    body.set(ssidBytes, 1)
    await this.controlOut(CTRL.WIFI_DEL, 0, 0, body)
  }

  async echo(data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) {
      await this.controlOut(CTRL.ECHO, 0, 0)
      return
    }
    // ECHO body capped by APP_CTRL_PAYLOAD_MAX. Chunk into separate ECHOs if
    // the message is larger; the device logs each chunk as it arrives.
    let offset = 0
    while (offset < data.byteLength) {
      const end = Math.min(offset + CTRL_CHUNK, data.byteLength)
      await this.controlOut(CTRL.ECHO, 0, 0, data.subarray(offset, end))
      offset = end
    }
  }

  async reboot(): Promise<void> {
    await this.controlOut(CTRL.REBOOT, 0, 0)
  }

  // ---------- byte pipes ----------

  async usbTx(data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) return
    if (this.pipeOutEndpoint === null) {
      throw new Error('bulk OUT 엔드포인트가 없습니다.')
    }
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    const result = await this.device.transferOut(this.pipeOutEndpoint, buffer)
    if (result.status !== 'ok') {
      throw new Error(`bulk OUT ${result.status}`)
    }
    // The board logs this as USB_IN, but that log is unreachable over USB, so
    // report it ourselves to keep the UI's two directions symmetric.
    this.emitBytes({ pipe: 'usb', dir: 'in', data: data.slice(), tMs: null })
  }

  async uartTx(): Promise<void> {
    throw new TransportUnsupportedError('UART 전송', this.transport)
  }

  async getUartConfig(): Promise<UartConfig> {
    throw new TransportUnsupportedError('UART 설정 조회', this.transport)
  }

  async setUartConfig(): Promise<UartConfig> {
    throw new TransportUnsupportedError('UART 설정 변경', this.transport)
  }

  async otaUpload(): Promise<void> {
    throw new TransportUnsupportedError('OTA 업로드', this.transport)
  }

  private emitBytes(ev: Parameters<ByteSubscriber>[0]): void {
    for (const cb of this.byteSubscribers) cb(ev)
  }

  subscribeBytes(cb: ByteSubscriber): () => void {
    this.byteSubscribers.add(cb)
    this.ensureReadLoop()
    return () => {
      this.byteSubscribers.delete(cb)
    }
  }

  // The log bus is HTTP-only, so these stay empty rather than pretending.
  async getLogSnapshot(): Promise<string> {
    return ''
  }

  subscribeLog(): () => void {
    return () => {}
  }

  private ensureReadLoop(): void {
    if (this.readToken) return
    if (this.pipeInEndpoint === null) return
    const ep = this.pipeInEndpoint
    const pkt = this.pipePacketSize
    const token = { stop: false }
    this.readToken = token
    void (async () => {
      while (!token.stop) {
        try {
          const result = await this.device.transferIn(ep, pkt)
          if (token.stop) return
          if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) {
            if (result.status === 'stall') {
              await this.device.clearHalt('in', ep).catch(() => {})
            }
            continue
          }
          const bytes = new Uint8Array(
            result.data.buffer.slice(
              result.data.byteOffset,
              result.data.byteOffset + result.data.byteLength,
            ),
          )
          this.emitBytes({ pipe: 'usb', dir: 'out', data: bytes, tMs: null })
        } catch {
          if (!token.stop) await new Promise((r) => setTimeout(r, 250))
        }
      }
    })()
  }

  async dispose(): Promise<void> {
    if (this.readToken) {
      this.readToken.stop = true
      this.readToken = null
    }
    this.byteSubscribers.clear()
  }
}

// ---------- TLV parsers ----------

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

function parseMapTlv(buf: Uint8Array): MapEntry[] {
  const out: MapEntry[] = []
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let off = 0
  while (off + 4 <= buf.byteLength) {
    const klen = dv.getUint16(off, true)
    off += 2
    if (off + klen + 2 > buf.byteLength) break
    const key = decoder.decode(buf.subarray(off, off + klen))
    off += klen
    const vlen = dv.getUint16(off, true)
    off += 2
    if (off + vlen > buf.byteLength) break
    const value = buf.slice(off, off + vlen)
    off += vlen
    out.push({ key, value })
  }
  return out
}

function parseWifiTlv(buf: Uint8Array): WifiCred[] {
  const out: WifiCred[] = []
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let off = 0
  while (off + 1 <= buf.byteLength) {
    const slen = buf[off++]
    if (off + slen + 1 > buf.byteLength) break
    const ssid = decoder.decode(buf.subarray(off, off + slen))
    off += slen
    const plen = buf[off++]
    if (off + plen > buf.byteLength) break
    const password = decoder.decode(buf.subarray(off, off + plen))
    off += plen
    out.push({ ssid, password })
  }
  return out
}
