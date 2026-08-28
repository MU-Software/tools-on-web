import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import LoginIcon from '@mui/icons-material/Login'
import { copyText } from '../../lib/clipboard'
import { downloadBlob } from '../../lib/download'
import { isUtf8 } from '../../lib/bytes'
import { CODECS, CODEC_BY_ID, type Codec, detectCodec } from './codecs'
import { sniff } from './media'

const MAX_FILE = 20 << 20

const EMPTY = new Uint8Array()

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}바이트`
  if (bytes < 1 << 20) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1 << 20)).toFixed(1)}MB`
}

type Source = {
  bytes: Uint8Array<ArrayBuffer>
  /** 자동으로 골랐을 때만 채워 넣어 어떤 형식으로 읽었는지 알립니다. */
  detected: Codec | null
  error: string
}

type Loaded = { name: string; bytes: Uint8Array<ArrayBuffer> }

function decodeText(text: string, inputId: string): Source {
  if (!text) return { bytes: EMPTY, detected: null, error: '' }
  const codec = inputId === 'auto' ? detectCodec(text) : (CODEC_BY_ID[inputId] ?? CODEC_BY_ID.text)
  try {
    return { bytes: codec.decode(text), detected: inputId === 'auto' ? codec : null, error: '' }
  } catch (e) {
    return { bytes: EMPTY, detected: inputId === 'auto' ? codec : null, error: message(e) }
  }
}

function encodeRow(codec: Codec, bytes: Uint8Array, text: boolean): { value: string; note: string } {
  if (codec.group === 'text' && !text) return { value: '', note: 'UTF-8 문자열이 아닙니다' }
  if (bytes.length > codec.maxBytes) return { value: '', note: `${formatSize(codec.maxBytes)}까지만 만듭니다` }
  try {
    return { value: codec.encode(bytes), note: '' }
  } catch (e) {
    return { value: '', note: message(e) }
  }
}

export default function EncodingConverter() {
  const [tab, setTab] = useState<'text' | 'file'>('text')
  const [text, setText] = useState('안녕하세요, Tools on Web!')
  const [inputId, setInputId] = useState('auto')
  const [file, setFile] = useState<Loaded | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState('')
  const pickerRef = useRef<HTMLInputElement>(null)

  const source = useMemo(
    () => (tab === 'file' ? { bytes: file?.bytes ?? EMPTY, detected: null, error: '' } : decodeText(text, inputId)),
    [tab, file, text, inputId],
  )

  const { bytes } = source
  const text8 = isUtf8(bytes)
  const media = useMemo(() => sniff(bytes, text8), [bytes, text8])
  const rows = useMemo(
    () => CODECS.map((codec) => ({ codec, ...encodeRow(codec, bytes, text8) })),
    [bytes, text8],
  )

  const previewable = bytes.length > 0 && ['image', 'audio', 'video'].includes(media.kind)
  const previewUrl = useMemo(
    () => (previewable ? URL.createObjectURL(new Blob([bytes], { type: media.mime })) : ''),
    [previewable, bytes, media.mime],
  )
  // 새 주소가 만들어질 때마다 직전 주소를 거둡니다.
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  const load = useCallback(async (picked: File | null) => {
    if (!picked) return
    if (picked.size > MAX_FILE) {
      setToast(`${formatSize(MAX_FILE)}까지만 읽습니다`)
      return
    }
    const buffer = await picked.arrayBuffer()
    setFile({ name: picked.name, bytes: new Uint8Array(buffer) })
    setTab('file')
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const picked = e.clipboardData?.files?.[0]
      if (picked) void load(picked)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [load])

  const copy = async (value: string, what: string) => {
    setToast((await copyText(value)) ? `${what} 복사` : '복사하지 못했습니다')
  }

  const feedBack = (codec: Codec, value: string) => {
    setTab('text')
    setInputId(codec.id)
    setText(value)
  }

  const save = () => {
    downloadBlob(new Blob([bytes], { type: media.mime }), file?.name ?? `data.${media.ext}`)
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, next: 'text' | 'file') => setTab(next)}
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab value="text" label="텍스트" />
          <Tab value="file" label="파일" />
        </Tabs>

        <CardContent>
          {tab === 'text' ? (
            <Stack spacing={1.5}>
              <TextField
                value={text}
                onChange={(e) => setText(e.target.value)}
                label="입력"
                placeholder="문자열, Base64, 16진수, \uXXXX, data: URL 무엇이든"
                size="small"
                multiline
                minRows={3}
                maxRows={10}
                slotProps={{
                  htmlInput: {
                    autoComplete: 'off',
                    spellCheck: false,
                    style: { fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' },
                  },
                }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
                <TextField
                  value={inputId}
                  onChange={(e) => setInputId(e.target.value)}
                  label="입력 형식"
                  size="small"
                  select
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="auto">자동 인식</MenuItem>
                  {CODECS.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
                {source.detected && (
                  <Chip size="small" variant="outlined" label={`${source.detected.label}(으)로 읽음`} />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" onClick={() => setText('')} disabled={!text}>
                  지우기
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Box
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  void load(e.dataTransfer.files[0] ?? null)
                }}
                onClick={() => pickerRef.current?.click()}
                sx={{
                  p: 4,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: dragging ? 'primary.main' : 'divider',
                  bgcolor: dragging ? 'action.hover' : 'transparent',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  이미지·음원·영상 등 아무 파일이나 끌어다 놓거나 눌러서 고르세요. 붙여넣기도 됩니다.
                </Typography>
              </Box>
              <input
                ref={pickerRef}
                type="file"
                hidden
                onChange={(e) => {
                  void load(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
              {file && (
                <Typography variant="body2" color="text.secondary">
                  {file.name} · {formatSize(file.bytes.length)}
                </Typography>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      {source.error && <Alert severity="warning">{source.error}</Alert>}

      {bytes.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Chip size="small" label={formatSize(bytes.length)} />
                <Chip size="small" variant="outlined" label={media.mime} />
                <Chip
                  size="small"
                  variant="outlined"
                  color={text8 ? 'success' : 'default'}
                  label={text8 ? 'UTF-8로 읽힘' : '이진 데이터'}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" startIcon={<DownloadIcon />} onClick={save}>
                  내려받기
                </Button>
              </Stack>

              {previewUrl && media.kind === 'image' && (
                <Box
                  component="img"
                  src={previewUrl}
                  alt="미리보기"
                  sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: 1, objectFit: 'contain' }}
                />
              )}
              {previewUrl && media.kind === 'audio' && (
                <Box component="audio" src={previewUrl} controls sx={{ width: '100%' }} />
              )}
              {previewUrl && media.kind === 'video' && (
                <Box
                  component="video"
                  src={previewUrl}
                  controls
                  sx={{ width: '100%', maxHeight: 360, borderRadius: 1, bgcolor: 'common.black' }}
                />
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {bytes.length > 0 &&
        (['bytes', 'text'] as const).map((group) => (
          <Card key={group} variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                {group === 'bytes' ? '바이트 표현' : '문자열 표현'}
              </Typography>
              <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
                {rows
                  .filter((r) => r.codec.group === group)
                  .map(({ codec, value, note }) => (
                    <Row
                      key={codec.id}
                      codec={codec}
                      value={value}
                      note={note}
                      onCopy={() => copy(value, codec.label)}
                      onFeed={() => feedBack(codec, value)}
                    />
                  ))}
              </Stack>
            </CardContent>
          </Card>
        ))}

      <Snackbar open={!!toast} message={toast} autoHideDuration={1800} onClose={() => setToast('')} />
    </Stack>
  )
}

function Row({
  codec,
  value,
  note,
  onCopy,
  onFeed,
}: {
  codec: Codec
  value: string
  note: string
  onCopy: () => void
  onFeed: () => void
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ py: 1, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 'none', width: { xs: '100%', sm: 190 }, pt: 0.25 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {codec.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {codec.hint}
        </Typography>
      </Box>

      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          maxHeight: 108,
          overflow: 'auto',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '.82rem',
          lineHeight: 1.55,
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
          color: note ? 'text.disabled' : 'text.primary',
        }}
      >
        {note || value}
      </Box>

      <Stack direction="row" sx={{ flex: 'none' }}>
        <Tooltip title="이 값을 입력으로">
          <span>
            <IconButton size="small" onClick={onFeed} disabled={!value} aria-label={`${codec.label}을 입력으로`}>
              <LoginIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="복사">
          <span>
            <IconButton size="small" onClick={onCopy} disabled={!value} aria-label={`${codec.label} 복사`}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  )
}
