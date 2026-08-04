import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardClient, Transport } from '../lib/boardClient'
import { HttpBoardClient } from '../lib/httpBoardClient'
import { UsbBoardClient } from '../lib/usbBoardClient'
import { claimFirstUsableInterface } from '../lib/usbInterface'

export type ConnState = 'idle' | 'connecting' | 'connected' | 'error'

export type UseBoardClient = {
  transport: Transport
  setTransport: (t: Transport) => void
  state: ConnState
  error: string | null
  client: BoardClient | null
  // HTTP-specific
  baseUrl: string
  setBaseUrl: (s: string) => void
  // USB-specific
  device: USBDevice | null
  requestUsbDevice: () => Promise<void>
  // shared lifecycle
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

const DEFAULT_HTTP_BASE = 'http://esp32-bst.local'

// Picks a usable bulk-IN endpoint (for live log streaming) on the given alt
// setting. Vendor-only firmware has one interface with bulk IN+OUT.
function pickBulkInEndpoint(alt: USBAlternateInterface):
  | { endpointNumber: number; packetSize: number }
  | null {
  for (const ep of alt.endpoints) {
    if (ep.type === 'bulk' && ep.direction === 'in') {
      return { endpointNumber: ep.endpointNumber, packetSize: ep.packetSize || 64 }
    }
  }
  return null
}

export function useBoardClient(): UseBoardClient {
  const [transport, setTransportState] = useState<Transport>('http')
  const [state, setState] = useState<ConnState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<BoardClient | null>(null)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_HTTP_BASE)
  const [device, setDevice] = useState<USBDevice | null>(null)

  const claimedRef = useRef<{ device: USBDevice; iface: number } | null>(null)
  // Mirror of `client` state so the unmount cleanup below sees the latest value
  // (a closure on `client` would capture the initial null).
  const clientRef = useRef<BoardClient | null>(null)

  const fail = useCallback((msg: string) => {
    setError(msg)
    setState('error')
  }, [])

  const releaseClaim = useCallback(() => {
    if (claimedRef.current) {
      const { device: d, iface } = claimedRef.current
      d.releaseInterface(iface).catch(() => {})
      claimedRef.current = null
    }
  }, [])

  const setTransport = useCallback(
    (t: Transport) => {
      setTransportState(t)
      if (client) void client.dispose()
      releaseClaim()
      setClient(null)
      setState('idle')
      setError(null)
    },
    [client, releaseClaim],
  )

  const requestUsbDevice = useCallback(async () => {
    if (!('usb' in navigator)) {
      fail('이 브라우저는 WebUSB를 지원하지 않습니다.')
      return
    }
    try {
      // VID 0x303A + PID 0x4001 = our TinyUSB vendor device. Without the PID
      // filter, the ESP32-S3's built-in USB-Serial-JTAG (PID 0x1001) also
      // shows up and selecting it leads to STALLs on our vendor requests.
      const d = await navigator.usb.requestDevice({
        filters: [{ vendorId: 0x303a, productId: 0x4001 }],
      })
      setDevice(d)
      setError(null)
    } catch (e) {
      fail((e as Error).message)
    }
  }, [fail])

  const connect = useCallback(async () => {
    setError(null)
    setState('connecting')
    try {
      if (transport === 'http') {
        const c = new HttpBoardClient({ baseUrl: baseUrl.trim() || undefined })
        await c.getStatus()  // probe
        setClient(c)
        setState('connected')
      } else {
        if (!device) throw new Error('USB 장치를 먼저 선택하세요.')
        if (!device.opened) await device.open()
        if (device.configuration === null) await device.selectConfiguration(1)
        const cfg = device.configuration
        if (!cfg || cfg.interfaces.length === 0) {
          throw new Error('USB 디바이스에 사용 가능한 인터페이스가 없습니다.')
        }
        // 인터페이스 0을 무조건 잡으면 CDC 복합 장치에서 OS 드라이버와 충돌한다.
        const claimed = await claimFirstUsableInterface(device)
        claimedRef.current = { device, iface: claimed.interfaceNumber }

        const alt = cfg.interfaces
          .find((i) => i.interfaceNumber === claimed.interfaceNumber)
          ?.alternates.find((a) => a.alternateSetting === claimed.alternate)
        const bulkIn = alt ? pickBulkInEndpoint(alt) : null
        const c = new UsbBoardClient({
          device,
          interfaceNumber: claimed.interfaceNumber,
          logEndpoint: bulkIn?.endpointNumber ?? null,
          logPacketSize: bulkIn?.packetSize ?? 64,
        })
        await c.getStatus()  // probe
        setClient(c)
        setState('connected')
      }
    } catch (e) {
      releaseClaim()
      fail((e as Error).message)
    }
  }, [baseUrl, device, fail, releaseClaim, transport])

  const disconnect = useCallback(async () => {
    if (client) await client.dispose()
    setClient(null)
    releaseClaim()
    setState('idle')
    setError(null)
  }, [client, releaseClaim])

  useEffect(() => {
    clientRef.current = client
  }, [client])

  useEffect(() => {
    return () => {
      if (clientRef.current) void clientRef.current.dispose()
      if (claimedRef.current) {
        const { device: d, iface } = claimedRef.current
        d.releaseInterface(iface).catch(() => {})
      }
    }
  }, [])

  return {
    transport,
    setTransport,
    state,
    error,
    client,
    baseUrl,
    setBaseUrl,
    device,
    requestUsbDevice,
    connect,
    disconnect,
  }
}
