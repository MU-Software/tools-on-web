import { useCallback, useEffect, useRef, useState } from 'react'

export type UsbStatus = 'idle' | 'requesting' | 'opening' | 'open' | 'closing' | 'error'

export type UsbEndpoints = {
  interfaceNumber: number
  alternate: number
  inEndpoint: number | null
  outEndpoint: number | null
  packetSize: number
}

export type UseEspUsb = {
  status: UsbStatus
  device: USBDevice | null
  endpoints: UsbEndpoints | null
  log: string
  request: (filters?: USBDeviceFilter[]) => Promise<void>
  open: () => Promise<void>
  close: () => Promise<void>
  send: (data: Uint8Array | string) => Promise<void>
  clearLog: () => void
}

function pickInterface(device: USBDevice): UsbEndpoints | null {
  const config = device.configuration
  if (!config) return null
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      let inEp: number | null = null
      let outEp: number | null = null
      let pkt = 64
      for (const ep of alt.endpoints) {
        if (ep.type !== 'bulk' && ep.type !== 'interrupt') continue
        if (ep.direction === 'in' && inEp === null) inEp = ep.endpointNumber
        if (ep.direction === 'out' && outEp === null) outEp = ep.endpointNumber
        if (ep.packetSize) pkt = ep.packetSize
      }
      if (inEp !== null || outEp !== null) {
        return {
          interfaceNumber: iface.interfaceNumber,
          alternate: alt.alternateSetting,
          inEndpoint: inEp,
          outEndpoint: outEp,
          packetSize: pkt,
        }
      }
    }
  }
  return null
}

function toBytes(input: Uint8Array | string): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input)
  return input
}

function hexDump(bytes: Uint8Array, max = 64): string {
  const slice = bytes.slice(0, max)
  const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ')
  return bytes.length > max ? `${hex} … (+${bytes.length - max} bytes)` : hex
}

export function useEspUsb(): UseEspUsb {
  const [status, setStatus] = useState<UsbStatus>('idle')
  const [device, setDevice] = useState<USBDevice | null>(null)
  const [endpoints, setEndpoints] = useState<UsbEndpoints | null>(null)
  const [log, setLog] = useState('')

  const readLoopRef = useRef<{ stop: boolean } | null>(null)

  const append = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString()
    setLog((prev) => `${prev}[${ts}] ${line}\n`)
  }, [])

  const stopReadLoop = useCallback(() => {
    if (readLoopRef.current) readLoopRef.current.stop = true
    readLoopRef.current = null
  }, [])

  const startReadLoop = useCallback(
    (dev: USBDevice, ep: UsbEndpoints) => {
      if (ep.inEndpoint === null) return
      const token = { stop: false }
      readLoopRef.current = token
      const inEp = ep.inEndpoint
      const pkt = ep.packetSize
      ;(async () => {
        while (!token.stop) {
          try {
            const result = await dev.transferIn(inEp, pkt)
            if (token.stop) return
            if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
              const bytes = new Uint8Array(
                result.data.buffer,
                result.data.byteOffset,
                result.data.byteLength,
              )
              append(`IN  (${bytes.length}B) ${hexDump(bytes)}`)
            } else if (result.status === 'stall') {
              await dev.clearHalt('in', inEp).catch(() => {})
            }
          } catch (err) {
            if (!token.stop) append(`[read error] ${(err as Error).message}`)
            return
          }
        }
      })()
    },
    [append],
  )

  const request = useCallback(
    async (filters: USBDeviceFilter[] = []) => {
      if (!('usb' in navigator)) {
        throw new Error('이 브라우저는 WebUSB를 지원하지 않습니다 (Chrome/Edge 사용).')
      }
      setStatus('requesting')
      try {
        const dev = await navigator.usb.requestDevice({ filters })
        setDevice(dev)
        append(
          `선택됨: ${dev.productName ?? '(no product)'} — VID=0x${dev.vendorId
            .toString(16)
            .padStart(4, '0')} PID=0x${dev.productId.toString(16).padStart(4, '0')}`,
        )
        setStatus('idle')
      } catch (err) {
        setStatus('error')
        append(`[request error] ${(err as Error).message}`)
      }
    },
    [append],
  )

  const open = useCallback(async () => {
    if (!device) throw new Error('먼저 USB 장치를 선택하세요.')
    setStatus('opening')
    try {
      await device.open()
      if (device.configuration === null) await device.selectConfiguration(1)
      const ep = pickInterface(device)
      if (!ep) throw new Error('사용 가능한 bulk/interrupt 엔드포인트를 찾지 못했습니다.')
      await device.claimInterface(ep.interfaceNumber)
      if (ep.alternate !== 0) {
        await device.selectAlternateInterface(ep.interfaceNumber, ep.alternate)
      }
      setEndpoints(ep)
      setStatus('open')
      append(
        `오픈됨: interface=${ep.interfaceNumber} alt=${ep.alternate} in=${ep.inEndpoint ?? '-'} out=${ep.outEndpoint ?? '-'}`,
      )
      startReadLoop(device, ep)
    } catch (err) {
      setStatus('error')
      append(`[open error] ${(err as Error).message}`)
      throw err
    }
  }, [append, device, startReadLoop])

  const close = useCallback(async () => {
    if (!device) return
    setStatus('closing')
    stopReadLoop()
    try {
      if (endpoints) {
        await device.releaseInterface(endpoints.interfaceNumber).catch(() => {})
      }
      await device.close().catch(() => {})
      append('연결 해제됨')
    } finally {
      setEndpoints(null)
      setStatus('idle')
    }
  }, [append, device, endpoints, stopReadLoop])

  const send = useCallback(
    async (data: Uint8Array | string) => {
      if (!device || !endpoints || endpoints.outEndpoint === null) {
        throw new Error('OUT 엔드포인트가 준비되지 않았습니다.')
      }
      const bytes = toBytes(data)
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      const result = await device.transferOut(endpoints.outEndpoint, buffer)
      append(`OUT (${result.bytesWritten}B) ${hexDump(bytes)}`)
    },
    [append, device, endpoints],
  )

  const clearLog = useCallback(() => setLog(''), [])

  useEffect(() => {
    return () => {
      stopReadLoop()
    }
  }, [stopReadLoop])

  return { status, device, endpoints, log, request, open, close, send, clearLog }
}
