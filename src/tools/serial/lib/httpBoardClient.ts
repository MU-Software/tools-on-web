import {
  type BoardClient,
  type BoardStatus,
  type LogSubscriber,
  type MapEntry,
  type WifiCred,
  bytesToHex,
  hexToBytes,
} from './boardClient'

type RawStatus = {
  boot_id: number
  uptime_ms: number
  map_count: number
  string_len: number
  log_all: boolean
  wifi_connected: boolean
  wifi_ap: boolean
}

export type HttpBoardClientOptions = {
  // e.g. http://esp32-bst.local — use empty string for relative (when served
  // from the device itself).
  baseUrl?: string
}

export class HttpBoardClient implements BoardClient {
  readonly transport = 'http' as const
  private readonly baseUrl: string
  private subscribers = new Set<LogSubscriber>()
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

  async getLogSnapshot(): Promise<string> {
    const res = await this.request('/api/log')
    return res.text()
  }

  subscribeLog(cb: LogSubscriber): () => void {
    this.subscribers.add(cb)
    this.ensureWs()
    return () => {
      this.subscribers.delete(cb)
      if (this.subscribers.size === 0) this.closeWs()
    }
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
    this.closeWs()
  }
}
