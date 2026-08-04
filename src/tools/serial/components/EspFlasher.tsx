import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import RefreshIcon from '@mui/icons-material/Refresh'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import BoltIcon from '@mui/icons-material/Bolt'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { useEspFlasher, type FlashFile } from '../hooks/useEspFlasher'

type Entry = FlashFile & { id: string; addressInput: string }

const DEFAULT_ADDRESSES = ['0x0', '0x8000', '0xe000', '0x10000']

export function EspFlasher() {
  const {
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
  } = useEspFlasher()
  const [files, setFiles] = useState<Entry[]>([])
  const [eraseAll, setEraseAll] = useState(false)
  const [busy, setBusy] = useState(false)

  const onAddFiles = async (list: FileList | null) => {
    if (!list) return
    const next: Entry[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      const buf = new Uint8Array(await f.arrayBuffer())
      const idx = files.length + next.length
      const guess = DEFAULT_ADDRESSES[idx] ?? '0x10000'
      next.push({
        id: `${Date.now()}-${i}-${f.name}`,
        name: f.name,
        data: buf,
        address: parseInt(guess, 16),
        addressInput: guess,
      })
    }
    setFiles((prev) => [...prev, ...next])
  }

  const updateAddress = (id: string, value: string) => {
    setFiles((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e
        const parsed = value.startsWith('0x') ? parseInt(value, 16) : parseInt(value, 10)
        return { ...e, addressInput: value, address: Number.isNaN(parsed) ? e.address : parsed }
      }),
    )
  }

  const remove = (id: string) => setFiles((prev) => prev.filter((e) => e.id !== id))

  const onConnect = async () => {
    setBusy(true)
    try {
      await connect()
    } catch {
      /* logged */
    } finally {
      setBusy(false)
    }
  }

  const onFlash = async () => {
    setBusy(true)
    try {
      await flash(files, { eraseAll })
    } catch {
      /* logged */
    } finally {
      setBusy(false)
    }
  }

  const onEraseFlash = async () => {
    const ok = window.confirm(
      '보드 플래시 전체를 삭제합니다. 펌웨어/파티션/NVS가 모두 사라지며 되돌릴 수 없습니다. 진행할까요?',
    )
    if (!ok) return
    setBusy(true)
    try {
      await eraseFlash()
    } catch {
      /* logged */
    } finally {
      setBusy(false)
    }
  }

  const onRefreshInfo = async () => {
    setBusy(true)
    try {
      await refreshBoardInfo()
    } catch {
      /* logged */
    } finally {
      setBusy(false)
    }
  }

  const percent = useMemo(() => {
    if (!progress || !progress.total) return 0
    return Math.round((progress.written / progress.total) * 100)
  }, [progress])

  const connected =
    status === 'connected' || status === 'flashing' || status === 'erasing'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="h6">ESP32-S3 WebSerial 플래셔</Typography>
          <Chip
            size="small"
            label={status}
            color={
              status === 'error'
                ? 'error'
                : status === 'connected'
                  ? 'success'
                  : status === 'flashing' || status === 'erasing'
                    ? 'warning'
                    : 'default'
            }
          />
          {chip && <Chip size="small" label={chip} variant="outlined" />}
          {boardInfo?.flashSize && (
            <Chip size="small" label={`Flash ${boardInfo.flashSize}`} variant="outlined" />
          )}
          <Box sx={{ flex: 1 }} />
          {!connected ? (
            <Button
              variant="contained"
              startIcon={<BoltIcon />}
              onClick={onConnect}
              disabled={busy}
            >
              보드 연결
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<RestartAltIcon />}
                onClick={() => hardReset()}
                disabled={busy}
              >
                하드 리셋
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LinkOffIcon />}
                onClick={() => disconnect()}
                disabled={busy}
              >
                연결 해제
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      {connected && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle1">보드 정보</Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={onRefreshInfo}
                disabled={busy}
              >
                새로고침
              </Button>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteSweepIcon />}
                onClick={onEraseFlash}
                disabled={busy || status === 'erasing' || status === 'flashing'}
              >
                플래시 전체 삭제
              </Button>
            </Stack>

            {!boardInfo ? (
              <Typography variant="body2" color="text.secondary">
                보드 정보를 가져오는 중이거나 사용할 수 없습니다.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  columnGap: 2,
                  rowGap: 0.75,
                  fontSize: 14,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Chip
                </Typography>
                <Typography variant="body2">
                  {boardInfo.description}
                  {boardInfo.revision ? ` (${boardInfo.revision})` : ''}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  MAC
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {boardInfo.mac}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  Crystal
                </Typography>
                <Typography variant="body2">{boardInfo.crystalMhz} MHz</Typography>

                <Typography variant="body2" color="text.secondary">
                  외부 SPI Flash
                </Typography>
                <Typography variant="body2">
                  {boardInfo.flashSize ?? '미감지'}
                  {boardInfo.flashIdHex && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 1, fontFamily: 'monospace' }}
                    >
                      (id {boardInfo.flashIdHex})
                    </Typography>
                  )}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  Features
                </Typography>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {boardInfo.features.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      —
                    </Typography>
                  ) : (
                    boardInfo.features.map((f) => (
                      <Chip key={f} size="small" label={f} variant="outlined" />
                    ))
                  )}
                </Stack>
              </Box>
            )}
            <Divider />
            <Typography variant="caption" color="text.secondary">
              ESP32-S3는 임베디드 PSRAM/Flash 용량을 eFuse에서 읽어 위 Features에 표시합니다. 외부
              SPI Flash 용량은 SFDP/RDID로 별도 감지합니다.
            </Typography>
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              펌웨어(.bin) 추가
              <input
                hidden
                type="file"
                accept=".bin"
                multiple
                onChange={(e) => {
                  void onAddFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </Button>
            <Button
              variant={eraseAll ? 'contained' : 'outlined'}
              color={eraseAll ? 'warning' : 'inherit'}
              onClick={() => setEraseAll((v) => !v)}
            >
              전체 지우기 {eraseAll ? 'ON' : 'OFF'}
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              color="primary"
              onClick={onFlash}
              disabled={!connected || files.length === 0 || busy}
            >
              플래시 시작
            </Button>
          </Stack>

          {files.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              .bin 파일을 추가하고 각 파일의 시작 주소를 지정하세요. (예: bootloader=0x0,
              partitions=0x8000, app=0x10000)
            </Typography>
          ) : (
            <Stack spacing={1}>
              {files.map((f, i) => (
                <Stack
                  key={f.id}
                  direction="row"
                  spacing={2}
                  sx={{
                    alignItems: 'center',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    pb: 1,
                  }}
                >
                  <Typography sx={{ minWidth: 24, color: 'text.secondary' }}>{i}</Typography>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">{f.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {f.data.length.toLocaleString()} bytes
                    </Typography>
                  </Box>
                  <TextField
                    size="small"
                    label="address"
                    value={f.addressInput}
                    onChange={(e) => updateAddress(f.id, e.target.value)}
                    sx={{ width: 140 }}
                  />
                  <IconButton onClick={() => remove(f.id)}>
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}

          {progress && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                파일 {progress.fileIndex + 1}/{files.length} — {percent}% (
                {progress.written.toLocaleString()} / {progress.total.toLocaleString()})
              </Typography>
              <LinearProgress variant="determinate" value={percent} />
            </Box>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2">로그</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={clearLog}>
            지우기
          </Button>
        </Stack>
        <Box
          component="pre"
          sx={{
            mt: 1,
            p: 1.5,
            maxHeight: 280,
            overflow: 'auto',
            bgcolor: 'background.default',
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {log || '(비어 있음)'}
        </Box>
      </Paper>
    </Stack>
  )
}
