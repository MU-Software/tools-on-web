import { useCallback, useEffect, useRef, useState } from 'react'
import { claimFirstUsableInterface } from '../lib/usbInterface'
import type { UsbEndpoints } from '../lib/usbInterface'

export type { UsbEndpoints }

export type UsbStatus = 'idle' | 'requesting' | 'opening' | 'open' | 'closing' | 'error'

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
      const ep = await claimFirstUsableInterface(device, ({ interfaceNumber, error }) => {
        append(`interface ${interfaceNumber} claim 실패 (OS 드라이버 점유 가능성): ${error.message}`)
      })
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
