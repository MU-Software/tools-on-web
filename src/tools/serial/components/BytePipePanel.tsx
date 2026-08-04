import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import SaveIcon from '@mui/icons-material/Save'
import {
  type BoardClient,
  type BytePipe,
  type ByteEvent,
  type UartConfig,
  bytesToHex,
  bytesToUtf8Lossy,
  hexToBytes,
  utf8ToBytes,
} from '../lib/boardClient'

type Encoding = 'utf8' | 'hex'
type ViewMode = 'hex' | 'text'

const PIPE_LABEL: Record<BytePipe, string> = {
  usb: 'USB 바이트 파이프',
  uart: 'UART (COM 포트)',
}

const PIPE_HINT: Record<BytePipe, string> = {
  usb: 'vendor bulk OUT 0x01 / IN 0x81',
  uart: 'UART0 · GPIO43 TX / GPIO44 RX',
}

function renderEvent(ev: ByteEvent, view: ViewMode): string {
  const dir = ev.dir === 'in' ? 'IN ' : 'OUT'
  const t = ev.tMs === null ? '' : `[${ev.tMs}] `
  const body = view === 'hex' ? bytesToHex(ev.data).replace(/(..)/g, '$1 ').trim() : bytesToUtf8Lossy(ev.data)
  return `${t}${dir} ${body}\n`
}

export function BytePipePanel({
  client,
  pipe,
  capable,
  reason,
}: {
  client: BoardClient
  pipe: BytePipe
  capable: boolean
  reason?: string
}) {
  const [text, setText] = useState('')
  const [encoding, setEncoding] = useState<Encoding>('utf8')
  const [view, setView] = useState<ViewMode>('hex')
  const [autoScroll, setAutoScroll] = useState(true)
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const eventsRef = useRef<ByteEvent[]>([])
  const preRef = useRef<HTMLPreElement | null>(null)
  const viewRef = useRef(view)
  const cap = 2000

  // The subscribe effect must not resubscribe when the view mode changes, so it
  // reads the mode through a ref.
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // Re-render on a frame boundary rather than per event — a fast pipe would
  // otherwise trigger a setState per 64-byte packet.
  useEffect(() => {
    if (!client.capabilities.byteStream) return
    let pending = false
    const flush = () => {
      pending = false
      setOut(eventsRef.current.map((e) => renderEvent(e, viewRef.current)).join(''))
    }
    const off = client.subscribeBytes((ev) => {
      if (ev.pipe !== pipe) return
      eventsRef.current.push(ev)
      if (eventsRef.current.length > cap) {
        eventsRef.current = eventsRef.current.slice(-cap)
      }
      if (!pending) {
        pending = true
        requestAnimationFrame(flush)
      }
    })
    return () => off()
  }, [client, pipe])

  // Re-render already-captured bytes when the view mode changes.
  useEffect(() => {
    setOut(eventsRef.current.map((e) => renderEvent(e, view)).join(''))
  }, [view])

  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [out, autoScroll])

  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      const bytes = encoding === 'hex' ? hexToBytes(text) : utf8ToBytes(text)
      if (pipe === 'usb') await client.usbTx(bytes)
      else await client.uartTx(bytes)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, opacity: capable ? 1 : 0.6 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">{PIPE_LABEL[pipe]}</Typography>
          <Chip size="small" variant="outlined" label={PIPE_HINT[pipe]} />
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            select
            label="보기"
            value={view}
            onChange={(e) => setView(e.target.value as ViewMode)}
            sx={{ width: 110 }}
          >
            <MenuItem value="hex">HEX</MenuItem>
            <MenuItem value="text">텍스트</MenuItem>
          </TextField>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Switch size="small" checked={autoScroll} onChange={(_, v) => setAutoScroll(v)} />
            <Typography variant="caption" color="text.secondary">
              자동 스크롤
            </Typography>
          </Stack>
          <Button
            size="small"
            onClick={() => {
              eventsRef.current = []
              setOut('')
            }}
          >
            지우기
          </Button>
        </Stack>

        {!capable && reason && <Alert severity="info">{reason}</Alert>}
        {err && <Alert severity="error">{err}</Alert>}

        {pipe === 'uart' && <UartLineCoding client={client} capable={capable} />}

        <Box
          component="pre"
          ref={preRef}
          sx={{
            m: 0,
            p: 1.5,
            minHeight: 96,
            maxHeight: 260,
            overflow: 'auto',
            bgcolor: 'background.default',
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {out || (capable ? '(수신 없음)' : '(연결된 전송으로는 읽을 수 없음)')}
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            select
            label="인코딩"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as Encoding)}
            sx={{ width: 120 }}
          >
            <MenuItem value="utf8">UTF-8</MenuItem>
            <MenuItem value="hex">HEX</MenuItem>
          </TextField>
          <TextField
            size="small"
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={encoding === 'hex' ? 'DE AD BE EF' : '보낼 바이트'}
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <Button
            size="small"
            variant="contained"
            startIcon={<SendIcon />}
            onClick={() => void send()}
            disabled={!capable || busy}
          >
            전송
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          IN = 보드가 받은 바이트 · OUT = 보드가 내보낸 바이트
        </Typography>
      </Stack>
    </Paper>
  )
}

// ---------- UART line coding ----------

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

function UartLineCoding({ client, capable }: { client: BoardClient; capable: boolean }) {
  const [cfg, setCfg] = useState<UartConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!capable) return
    setBusy(true)
    setErr(null)
    try {
      setCfg(await client.getUartConfig())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [capable, client])

  useEffect(() => {
    // 마운트 시 보드에서 현재 회선 설정을 1회 조회
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const apply = async () => {
    if (!cfg) return
    setBusy(true)
    setErr(null)
    try {
      setCfg(await client.setUartConfig(cfg))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!capable) return null

  return (
    <Stack spacing={1}>
      {err && <Alert severity="error">{err}</Alert>}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          select
          label="baud"
          value={cfg?.baud ?? 115200}
          onChange={(e) => cfg && setCfg({ ...cfg, baud: Number(e.target.value) })}
          disabled={!cfg || busy}
          sx={{ width: 130 }}
        >
          {BAUDS.map((b) => (
            <MenuItem key={b} value={b}>
              {b}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label="data"
          value={cfg?.dataBits ?? 8}
          onChange={(e) => cfg && setCfg({ ...cfg, dataBits: Number(e.target.value) })}
          disabled={!cfg || busy}
          sx={{ width: 90 }}
        >
          {[5, 6, 7, 8].map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label="parity"
          value={cfg?.parity ?? 'N'}
          onChange={(e) =>
            cfg && setCfg({ ...cfg, parity: e.target.value as UartConfig['parity'] })
          }
          disabled={!cfg || busy}
          sx={{ width: 100 }}
        >
          <MenuItem value="N">None</MenuItem>
          <MenuItem value="E">Even</MenuItem>
          <MenuItem value="O">Odd</MenuItem>
        </TextField>
        <TextField
          size="small"
          select
          label="stop"
          value={cfg?.stopBits ?? 1}
          onChange={(e) => cfg && setCfg({ ...cfg, stopBits: Number(e.target.value) })}
          disabled={!cfg || busy}
          sx={{ width: 90 }}
        >
          {[1, 2].map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SaveIcon />}
          onClick={() => void apply()}
          disabled={!cfg || busy}
        >
          적용
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        WebSerial 클라이언트가 COM 포트를 연 설정과 맞춰야 합니다.
      </Typography>
    </Stack>
  )
}
