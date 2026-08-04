import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import SendIcon from '@mui/icons-material/Send'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import UsbIcon from '@mui/icons-material/Usb'
import WifiIcon from '@mui/icons-material/Wifi'
import {
  type BoardClient,
  type BoardStatus,
  type MapEntry,
  type WifiCred,
  bytesToHex,
  bytesToUtf8Lossy,
  hexToBytes,
  utf8ToBytes,
} from '../lib/boardClient'
import { useBoardClient } from '../hooks/useBoardClient'

export function BoardControl() {
  const board = useBoardClient()

  return (
    <Stack spacing={2}>
      <ConnectionPanel board={board} />
      {board.state === 'error' && board.error && (
        <Alert severity="error">{board.error}</Alert>
      )}
      {board.client && (
        <>
          <StatusPanel client={board.client} />
          <StringPanel client={board.client} />
          <MapPanel client={board.client} />
          <WifiPanel client={board.client} />
          <ActionsPanel client={board.client} />
          <LogPanel client={board.client} />
        </>
      )}
    </Stack>
  )
}

// ---------- Connection ----------

function ConnectionPanel({ board }: { board: ReturnType<typeof useBoardClient> }) {
  const connected = board.state === 'connected'
  const connecting = board.state === 'connecting'

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="h6">보드 제어</Typography>
          <Chip
            size="small"
            label={board.state}
            color={
              board.state === 'error'
                ? 'error'
                : connected
                  ? 'success'
                  : connecting
                    ? 'warning'
                    : 'default'
            }
          />
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={board.transport}
            onChange={(_, v) => v && board.setTransport(v)}
            disabled={connected || connecting}
          >
            <ToggleButton value="http">HTTP</ToggleButton>
            <ToggleButton value="usb">USB</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          {board.transport === 'http' ? (
            <TextField
              size="small"
              label="기본 URL"
              value={board.baseUrl}
              onChange={(e) => board.setBaseUrl(e.target.value)}
              placeholder="http://esp32-bst.local"
              sx={{ flex: 1, minWidth: 280 }}
              disabled={connected || connecting}
            />
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }}>
              <Button
                variant="outlined"
                startIcon={<UsbIcon />}
                onClick={() => void board.requestUsbDevice()}
                disabled={connected || connecting}
              >
                장치 선택
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {board.device
                  ? `${board.device.productName ?? 'USB Device'} · VID 0x${board.device.vendorId.toString(16).padStart(4, '0')}`
                  : '아직 선택되지 않음'}
              </Typography>
            </Stack>
          )}
          {!connected ? (
            <Button
              variant="contained"
              startIcon={<LinkIcon />}
              onClick={() => void board.connect()}
              disabled={
                connecting ||
                (board.transport === 'usb' && !board.device) ||
                (board.transport === 'http' && !board.baseUrl)
              }
            >
              연결
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="error"
              startIcon={<LinkOffIcon />}
              onClick={() => void board.disconnect()}
            >
              연결 해제
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  )
}

// ---------- Status ----------

function StatusPanel({ client }: { client: BoardClient }) {
  const [status, setStatus] = useState<BoardStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      setStatus(await client.getStatus())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [client])

  useEffect(() => {
    // 마운트 시 보드 상태 1회 조회 — 외부 장치와의 동기화라 규칙 예외
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const toggleLogAll = async (on: boolean) => {
    setBusy(true)
    setErr(null)
    try {
      await client.setLogAll(on)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1">상태</Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={busy}
          >
            새로고침
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        {status && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              columnGap: 2,
              rowGap: 0.5,
              fontSize: 14,
            }}
          >
            <T>boot id</T>
            <V>{status.bootId}</V>
            <T>uptime</T>
            <V>{(status.uptimeMs / 1000).toFixed(1)} s</V>
            <T>map entries</T>
            <V>{status.mapCount}</V>
            <T>string length</T>
            <V>{status.stringLen.toLocaleString()} bytes</V>
            <T>wifi station</T>
            <V>{status.wifiConnected ? '연결됨' : '미연결'}</V>
            <T>wifi AP</T>
            <V>{status.wifiAp ? '활성' : '비활성'}</V>
            <T>log_all</T>
            <V>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Switch
                  size="small"
                  checked={status.logAll}
                  onChange={(_, v) => void toggleLogAll(v)}
                  disabled={busy}
                />
                <Typography variant="body2" color="text.secondary">
                  모든 제어 트래픽을 로그에 기록
                </Typography>
              </Stack>
            </V>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

const T = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2" color="text.secondary">
    {children}
  </Typography>
)
const V = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2">{children}</Typography>
)

// ---------- String ----------

function StringPanel({ client }: { client: BoardClient }) {
  const [text, setText] = useState('')
  const [encoding, setEncoding] = useState<'utf8' | 'hex'>('utf8')
  const [size, setSize] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const bytes = await client.getString()
      setSize(bytes.byteLength)
      setText(encoding === 'hex' ? bytesToHex(bytes) : bytesToUtf8Lossy(bytes))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [client, encoding])

  const save = async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const bytes = encoding === 'hex' ? hexToBytes(text) : utf8ToBytes(text)
      await client.setString(bytes)
      setSize(bytes.byteLength)
      setInfo(`${bytes.byteLength.toLocaleString()} bytes 저장됨`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">롱 스트링</Typography>
          <Chip size="small" label={`${size.toLocaleString()} bytes`} variant="outlined" />
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            select
            label="인코딩"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as 'utf8' | 'hex')}
            sx={{ width: 140 }}
            disabled={busy}
          >
            <MenuItem value="utf8">UTF-8</MenuItem>
            <MenuItem value="hex">HEX</MenuItem>
          </TextField>
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => void load()}
            disabled={busy}
          >
            불러오기
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void save()}
            disabled={busy}
          >
            저장
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        {info && <Alert severity="success">{info}</Alert>}
        <TextField
          multiline
          minRows={4}
          maxRows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={encoding === 'hex' ? 'DE AD BE EF' : '내용을 입력하세요'}
          slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
      </Stack>
    </Paper>
  )
}

// ---------- Map ----------

type MapRow = { id: string; key: string; value_hex: string }

function MapPanel({ client }: { client: BoardClient }) {
  const [rows, setRows] = useState<MapRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const entries = await client.getMap()
      setRows(
        entries.map((e, i) => ({
          id: `${Date.now()}-${i}`,
          key: e.key,
          value_hex: bytesToHex(e.value),
        })),
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [client])

  const save = async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const entries: MapEntry[] = rows.map((r) => ({
        key: r.key,
        value: hexToBytes(r.value_hex),
      }))
      await client.putMap(entries)
      setInfo(`${entries.length}개 항목 저장됨`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const update = (id: string, patch: Partial<MapRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id))
  const add = () =>
    setRows((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, key: '', value_hex: '' },
    ])

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">키-값 맵</Typography>
          <Chip size="small" label={`${rows.length} 항목`} variant="outlined" />
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={busy}>
            불러오기
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={busy}>
            추가
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void save()}
            disabled={busy}
          >
            저장
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        {info && <Alert severity="success">{info}</Alert>}
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            항목이 없습니다. "불러오기"로 보드 상태를 가져오거나 "추가"로 새 항목을 작성하세요.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {rows.map((r) => (
              <Stack
                key={r.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <TextField
                  size="small"
                  label="key"
                  value={r.key}
                  onChange={(e) => update(r.id, { key: e.target.value })}
                  sx={{ width: 200 }}
                />
                <TextField
                  size="small"
                  label="value (hex)"
                  value={r.value_hex}
                  onChange={(e) => update(r.id, { value_hex: e.target.value })}
                  sx={{ flex: 1, fontFamily: 'monospace' }}
                  slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                />
                <IconButton size="small" onClick={() => remove(r.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

// ---------- WiFi ----------

type WifiRow = { id: string; ssid: string; password: string }

function WifiPanel({ client }: { client: BoardClient }) {
  const [rows, setRows] = useState<WifiRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [show, setShow] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const creds = await client.getWifi()
      setRows(creds.map((c, i) => ({ id: `${Date.now()}-${i}`, ...c })))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [client])

  const save = async () => {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const creds: WifiCred[] = rows.map((r) => ({ ssid: r.ssid, password: r.password }))
      await client.putWifi(creds)
      setInfo(`${creds.length}개 자격증명 저장됨`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const update = (id: string, patch: Partial<WifiRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id))
  const add = () =>
    setRows((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, ssid: '', password: '' },
    ])

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">WiFi 자격증명</Typography>
          <WifiIcon fontSize="small" color="action" />
          <Chip size="small" label={`${rows.length}개`} variant="outlined" />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Switch size="small" checked={show} onChange={(_, v) => setShow(v)} />
            <Typography variant="caption" color="text.secondary">
              비밀번호 표시
            </Typography>
          </Stack>
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={busy}>
            불러오기
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={busy}>
            추가
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void save()}
            disabled={busy}
          >
            저장
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        {info && <Alert severity="success">{info}</Alert>}
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            저장된 자격증명이 없습니다.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {rows.map((r) => (
              <Stack key={r.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="SSID"
                  value={r.ssid}
                  onChange={(e) => update(r.id, { ssid: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  type={show ? 'text' : 'password'}
                  label="password"
                  value={r.password}
                  onChange={(e) => update(r.id, { password: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <IconButton size="small" onClick={() => remove(r.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

// ---------- Echo + Reboot ----------

function ActionsPanel({ client }: { client: BoardClient }) {
  const [text, setText] = useState('hello serial\n')
  const [encoding, setEncoding] = useState<'utf8' | 'hex'>('utf8')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const sendEcho = async () => {
    setBusy(true)
    setErr(null)
    try {
      const bytes = encoding === 'hex' ? hexToBytes(text) : utf8ToBytes(text)
      await client.echo(bytes)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reboot = async () => {
    if (!window.confirm('보드를 재부팅합니다. 진행할까요?')) return
    setBusy(true)
    setErr(null)
    try {
      await client.reboot()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">에코 / 리부트</Typography>
          <Box sx={{ flex: 1 }} />
          <TextField
            size="small"
            select
            label="인코딩"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as 'utf8' | 'hex')}
            sx={{ width: 140 }}
          >
            <MenuItem value="utf8">UTF-8</MenuItem>
            <MenuItem value="hex">HEX</MenuItem>
          </TextField>
          <Button
            size="small"
            variant="contained"
            startIcon={<SendIcon />}
            onClick={() => void sendEcho()}
            disabled={busy}
          >
            에코 전송
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<RestartAltIcon />}
            onClick={() => void reboot()}
            disabled={busy}
          >
            재부팅
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        <TextField
          multiline
          minRows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={encoding === 'hex' ? 'DE AD BE EF' : '에코할 메시지'}
          slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
        />
      </Stack>
    </Paper>
  )
}

// ---------- Live log ----------

function LogPanel({ client }: { client: BoardClient }) {
  const [text, setText] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const ref = useRef<HTMLPreElement | null>(null)
  const linesRef = useRef<string[]>([])
  const tailCap = 4000

  // Refresh the rendered log periodically; appending to React state on every
  // line would re-render too aggressively under heavy log volume.
  useEffect(() => {
    let pending = false
    const onLine = (line: string) => {
      linesRef.current.push(line)
      if (linesRef.current.length > tailCap) {
        linesRef.current = linesRef.current.slice(-tailCap)
      }
      if (!pending) {
        pending = true
        requestAnimationFrame(() => {
          pending = false
          setText(linesRef.current.join(''))
        })
      }
    }
    const off = client.subscribeLog(onLine)
    void client.getLogSnapshot().then((snap) => {
      if (snap) {
        linesRef.current = snap.split(/(?<=\n)/)
        if (linesRef.current.length > tailCap) {
          linesRef.current = linesRef.current.slice(-tailCap)
        }
        setText(linesRef.current.join(''))
      }
    })
    return () => off()
  }, [client])

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [text, autoScroll])

  const transportLabel = useMemo(
    () =>
      client.transport === 'http'
        ? 'WebSocket /ws/log'
        : 'CDC bulk-IN (USB)',
    [client.transport],
  )

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">실시간 로그</Typography>
          <Chip size="small" label={transportLabel} variant="outlined" />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Switch
              size="small"
              checked={autoScroll}
              onChange={(_, v) => setAutoScroll(v)}
            />
            <Typography variant="caption" color="text.secondary">
              자동 스크롤
            </Typography>
          </Stack>
          <Button
            size="small"
            onClick={() => {
              linesRef.current = []
              setText('')
            }}
          >
            지우기
          </Button>
        </Stack>
        <Box
          component="pre"
          ref={ref}
          sx={{
            m: 0,
            p: 1.5,
            maxHeight: 360,
            overflow: 'auto',
            bgcolor: 'background.default',
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text || '(비어 있음)'}
        </Box>
      </Stack>
    </Paper>
  )
}
