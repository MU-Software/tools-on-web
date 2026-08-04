import { useCallback, useRef, useState } from 'react'
import { ESPLoader, Transport, type FlashOptions, type LoaderOptions } from 'esptool-js'

export type FlashFile = {
  data: Uint8Array
  address: number
  name: string
}

export type FlasherStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'flashing'
  | 'erasing'
  | 'error'

export type FlashProgress = {
  fileIndex: number
  written: number
  total: number
}

export type BoardInfo = {
  chipName: string
  description: string
  features: string[]
  crystalMhz: number
  mac: string
  revision: string | null
  flashSize: string | null
  flashIdHex: string
}

export type UseEspFlasher = {
  status: FlasherStatus
  chip: string | null
  boardInfo: BoardInfo | null
  log: string
  progress: FlashProgress | null
  connect: (baudrate?: number) => Promise<void>
  disconnect: () => Promise<void>
  flash: (files: FlashFile[], opts?: { eraseAll?: boolean }) => Promise<void>
  eraseFlash: () => Promise<void>
  refreshBoardInfo: () => Promise<void>
  hardReset: () => Promise<void>
  clearLog: () => void
}

export function useEspFlasher(): UseEspFlasher {
  const [status, setStatus] = useState<FlasherStatus>('idle')
  const [chip, setChip] = useState<string | null>(null)
  const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null)
  const [log, setLog] = useState('')
  const [progress, setProgress] = useState<FlashProgress | null>(null)

  const transportRef = useRef<Transport | null>(null)
  const loaderRef = useRef<ESPLoader | null>(null)

  const append = useCallback((s: string) => {
    setLog((prev) => prev + s)
  }, [])

  const collectBoardInfo = useCallback(
    async (loader: ESPLoader): Promise<BoardInfo> => {
      const rom = loader.chip
      // Serial transport은 한 번에 한 명령만 처리할 수 있으므로 순차 실행 필요.
      const description = await rom.getChipDescription(loader)
      const features = await rom.getChipFeatures(loader)
      const crystalMhz = await rom.getCrystalFreq(loader)
      const mac = await rom.readMac(loader)

      let revision: string | null = null
      try {
        type RevisionRom = {
          getMajorChipVersion?: (l: ESPLoader) => Promise<number>
          getMinorChipVersion?: (l: ESPLoader) => Promise<number>
          getChipRevision?: (l: ESPLoader) => Promise<number>
        }
        const ext = rom as unknown as RevisionRom
        if (ext.getMajorChipVersion && ext.getMinorChipVersion) {
          const major = await ext.getMajorChipVersion(loader)
          const minor = await ext.getMinorChipVersion(loader)
          revision = `v${major}.${minor}`
        } else if (ext.getChipRevision) {
          const r = await ext.getChipRevision(loader)
          revision = `rev${r}`
        }
      } catch (e) {
        append(`[info] revision skip: ${(e as Error).message}\n`)
      }

      let flashSize: string | null = null
      try {
        flashSize = await loader.detectFlashSize()
      } catch (e) {
        append(`[info] flash size skip: ${(e as Error).message}\n`)
      }

      let flashIdHex = ''
      try {
        const id = await loader.readFlashId()
        const manufacturer = (id & 0xff).toString(16).padStart(2, '0')
        const device = ((id >> 8) & 0xff).toString(16).padStart(2, '0')
        const sizeId = ((id >> 16) & 0xff).toString(16).padStart(2, '0')
        flashIdHex = `${manufacturer}:${device}${sizeId}`
      } catch (e) {
        append(`[info] flash id skip: ${(e as Error).message}\n`)
      }

      return {
        chipName: rom.CHIP_NAME,
        description,
        features,
        crystalMhz,
        mac,
        revision,
        flashSize,
        flashIdHex,
      }
    },
    [append],
  )

  const connect = useCallback(
    async (baudrate = 921600) => {
      if (!('serial' in navigator)) {
        throw new Error('이 브라우저는 WebSerial을 지원하지 않습니다 (Chrome/Edge 사용).')
      }
      setStatus('connecting')
      setProgress(null)
      setBoardInfo(null)
      try {
        const port = await navigator.serial.requestPort()
        const transport = new Transport(port, true)
        transportRef.current = transport

        const opts: LoaderOptions = {
          transport,
          baudrate,
          terminal: {
            clean: () => setLog(''),
            write: (data: string) => append(data),
            writeLine: (data: string) => append(data + '\n'),
          },
          debugLogging: false,
        }
        const loader = new ESPLoader(opts)
        loaderRef.current = loader

        const detectedChip = await loader.main()
        setChip(detectedChip)
        setStatus('connected')

        try {
          const info = await collectBoardInfo(loader)
          setBoardInfo(info)
        } catch (infoErr) {
          append(`\n[board info error] ${(infoErr as Error).message}\n`)
        }
      } catch (err) {
        setStatus('error')
        append(`\n[connect error] ${(err as Error).message}\n`)
        await transportRef.current?.disconnect().catch(() => {})
        transportRef.current = null
        loaderRef.current = null
        throw err
      }
    },
    [append, collectBoardInfo],
  )

  const disconnect = useCallback(async () => {
    try {
      await transportRef.current?.disconnect()
    } finally {
      transportRef.current = null
      loaderRef.current = null
      setStatus('idle')
      setChip(null)
      setBoardInfo(null)
      setProgress(null)
    }
  }, [])

  const refreshBoardInfo = useCallback(async () => {
    const loader = loaderRef.current
    if (!loader) throw new Error('먼저 보드에 연결하세요.')
    const info = await collectBoardInfo(loader)
    setBoardInfo(info)
  }, [collectBoardInfo])

  const flash = useCallback(
    async (files: FlashFile[], opts?: { eraseAll?: boolean }) => {
      const loader = loaderRef.current
      if (!loader) throw new Error('먼저 보드에 연결하세요.')
      if (files.length === 0) throw new Error('플래시할 파일이 없습니다.')

      setStatus('flashing')
      setProgress({ fileIndex: 0, written: 0, total: files[0]?.data.length ?? 0 })

      const flashOptions: FlashOptions = {
        fileArray: files.map((f) => ({ data: f.data, address: f.address })),
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: opts?.eraseAll ?? false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          setProgress({ fileIndex, written, total })
        },
      }

      try {
        await loader.writeFlash(flashOptions)
        setStatus('connected')
      } catch (err) {
        setStatus('error')
        append(`\n[flash error] ${(err as Error).message}\n`)
        throw err
      }
    },
    [append],
  )

  const eraseFlash = useCallback(async () => {
    const loader = loaderRef.current
    if (!loader) throw new Error('먼저 보드에 연결하세요.')

    setStatus('erasing')
    append('\n[erase] 전체 플래시 삭제 시작 (수십 초~수 분 소요)...\n')
    try {
      await loader.eraseFlash()
      append('[erase] 완료.\n')
      setStatus('connected')
    } catch (err) {
      setStatus('error')
      append(`\n[erase error] ${(err as Error).message}\n`)
      throw err
    }
  }, [append])

  const hardReset = useCallback(async () => {
    const loader = loaderRef.current
    if (!loader) return
    await loader.after('hard_reset')
  }, [])

  const clearLog = useCallback(() => setLog(''), [])

  return {
    status,
    chip,
    boardInfo,
    log,
    progress,
    connect,
    disconnect,
    flash,
    eraseFlash,
    refreshBoardInfo,
    hardReset,
    clearLog,
  }
}
