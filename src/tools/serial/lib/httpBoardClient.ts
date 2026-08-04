import {
  type BoardCapabilities,
  type BoardClient,
  type BoardStatus,
  type ByteSubscriber,
  type LogSubscriber,
  type MapEntry,
  type UartConfig,
  type WifiCred,
  bytesToHex,
  hexToBytes,
  parseByteLogLine,
} from './boardClient'

type RawUartConfig = {
  baud: number
  data_bits: number
  parity: string
  stop_bits: number
}

type RawStatus = {
  boot_id: number
  uptime_ms: number
  map_count: number
  string_len: number
  log_all: boolean
  wifi_connected: boolean
  wifi_ap: boolean
  usb?: { mounted: boolean; rx_bytes: number; tx_bytes: number; rx_dropped: number }
  uart?: RawUartConfig & { rx_bytes: number; tx_bytes: number }
}

function toUartConfig(r: RawUartConfig): UartConfig {
  const p = (r.parity ?? 'N').toUpperCase()
  return {
    baud: r.baud,
    dataBits: r.data_bits,
    parity: p === 'E' || p === 'O' ? p : 'N',
    stopBits: r.stop_bits,
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return buf
}

export type HttpBoardClientOptions = {
  // e.g. http://esp32-bst.local — use empty string for relative (when served
  // from the device itself).
  baseUrl?: string
}

export class HttpBoardClient implements BoardClient {
  readonly transport = 'http' as const
  // HTTP reaches every firmware surface.
  readonly capabilities: BoardCapabilities = {
    log: true,
    byteStream: true,
    usbPipe: true,
    uart: true,
    ota: true,
  }
  private readonly baseUrl: string
  private subscribers = new Set<LogSubscriber>()
  private byteSubscribers = new Set<ByteSubscriber>()
  private ws: WebSocket | null = null
  private wsClosed = false

  constructor(opts: HttpBoardClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '')
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(this.url(path), init)
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const j = (await res.clone().json()) as { error?: string }
        if (j.error) msg = `${msg}: ${j.error}`
      } catch {
        /* not json */
      }
      throw new Error(msg)
    }
    return res
  }

  async getStatus(): Promise<BoardStatus> {
    const res = await this.request('/api/status')
    const j = (await res.json()) as RawStatus
    return {
      bootId: j.boot_id,
      uptimeMs: j.uptime_ms,
      mapCount: j.map_count,
      stringLen: j.string_len,
      logAll: j.log_all,
      wifiConnected: j.wifi_connected,
      wifiAp: j.wifi_ap,
      usb: j.usb && {
        mounted: j.usb.mounted,
        rxBytes: j.usb.rx_bytes,
        txBytes: j.usb.tx_bytes,
        rxDropped: j.usb.rx_dropped,
      },
      uart: j.uart && {
        ...toUartConfig(j.uart),
        rxBytes: j.uart.rx_bytes,
        txBytes: j.uart.tx_bytes,
      },
    }
  }

  async setLogAll(on: boolean): Promise<void> {
    await this.request('/api/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_all: on }),
    })
  }

  async getString(): Promise<Uint8Array> {
    const res = await this.request('/api/string')
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }

  async setString(data: Uint8Array): Promise<void> {
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    await this.request('/api/string', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    })
  }

  async getMap(): Promise<MapEntry[]> {
    const res = await this.request('/api/map')
    const j = (await res.json()) as { entries: { key: string; value_hex: string }[] }
    return j.entries.map((e) => ({ key: e.key, value: hexToBytes(e.value_hex) }))
  }

  async putMap(entries: MapEntry[]): Promise<void> {
    const body = JSON.stringify({
      entries: entries.map((e) => ({ key: e.key, value_hex: bytesToHex(e.value) })),
    })
    await this.request('/api/map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  async getWifi(): Promise<WifiCred[]> {
    const res = await this.request('/api/wifi')
    const j = (await res.json()) as { creds: WifiCred[] }
    return j.creds
  }

  async putWifi(creds: WifiCred[]): Promise<void> {
    await this.request('/api/wifi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creds }),
    })
  }

  async echo(data: Uint8Array): Promise<void> {
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    await this.request('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    })
  }

  async reboot(): Promise<void> {
    await this.request('/api/reboot', { method: 'POST' })
  }

  // ---------- byte pipes ----------

  // The firmware accepts TX over the log WebSocket as well as REST, and prefers
  // it for live UIs (no CORS preflight per send). Use the socket when it is
  // already open; otherwise POST, which also gives us a real error to show.
  //
  // Both paths are size-capped on the device — WS_RX_MAX 4096 per frame (and
  // hex doubles the payload) and TX_MAX_BODY 8 KB per request. An oversized WS
  // frame is dropped without a reply, so chunk here rather than lose bytes.
  private async tx(target: 'usb' | 'uart', data: Uint8Array): Promise<void> {
    if (data.byteLength === 0) return
    const viaWs = this.ws !== null && this.ws.readyState === WebSocket.OPEN
    const chunkSize = viaWs ? 1024 : 4096
    for (let off = 0; off < data.byteLength; off += chunkSize) {
      const chunk = data.subarray(off, Math.min(off + chunkSize, data.byteLength))
      if (viaWs && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ target, hex: bytesToHex(chunk) }))
        continue
      }
      await this.request(`/api/${target}/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: toArrayBuffer(chunk),
      })
    }
  }

  async usbTx(data: Uint8Array): Promise<void> {
    await this.tx('usb', data)
  }

  async uartTx(data: Uint8Array): Promise<void> {
    await this.tx('uart', data)
  }

  async getUartConfig(): Promise<UartConfig> {
    const res = await this.request('/api/uart/config')
    return toUartConfig((await res.json()) as RawUartConfig)
  }

  async setUartConfig(cfg: UartConfig): Promise<UartConfig> {
    const res = await this.request('/api/uart/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baud: cfg.baud,
        data_bits: cfg.dataBits,
        parity: cfg.parity,
        stop_bits: cfg.stopBits,
      }),
    })
    return toUartConfig((await res.json()) as RawUartConfig)
  }

  subscribeBytes(cb: ByteSubscriber): () => void {
    this.byteSubscribers.add(cb)
    this.ensureWs()
    return () => {
      this.byteSubscribers.delete(cb)
      this.maybeCloseWs()
    }
  }

  async otaUpload(image: Uint8Array, sha256Hex?: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
    if (sha256Hex) headers['X-Firmware-SHA256'] = sha256Hex
    await this.request('/api/ota', {
      method: 'POST',
      headers,
      body: toArrayBuffer(image),
    })
  }

  async getLogSnapshot(): Promise<string> {
    const res = await this.request('/api/log')
    return res.text()
  }

  subscribeLog(cb: LogSubscriber): () => void {
    this.subscribers.add(cb)
    this.ensureWs()
    return () => {
      this.subscribers.delete(cb)
      this.maybeCloseWs()
    }
  }

  private maybeCloseWs(): void {
    if (this.subscribers.size === 0 && this.byteSubscribers.size === 0) this.closeWs()
  }

  private ensureWs(): void {
    if (this.ws || this.wsClosed) return
    // Derive ws:// from http:// (or wss:// from https://). Empty baseUrl means
    // we're served from the device — derive from window.location.
    let wsUrl: string
    if (this.baseUrl) {
      wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/log'
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${proto}//${location.host}/ws/log`
    }
    try {
      const ws = new WebSocket(wsUrl)
      this.ws = ws
      ws.onmessage = (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : ''
        if (!text) return
        for (const cb of this.subscribers) cb(text)
        if (this.byteSubscribers.size === 0) return
        // A frame is normally one log line, but split defensively.
        for (const line of text.split('\n')) {
          if (!line) continue
          const ev2 = parseByteLogLine(line)
          if (!ev2) continue
          for (const cb of this.byteSubscribers) cb(ev2)
        }
      }
      ws.onclose = () => {
        this.ws = null
      }
      ws.onerror = () => {
        // Leave .ws set; onclose will follow and clear it.
      }
    } catch {
      this.ws = null
    }
  }

  private closeWs(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  async dispose(): Promise<void> {
    this.wsClosed = true
    this.subscribers.clear()
    this.byteSubscribers.clear()
    this.closeWs()
  }
}
