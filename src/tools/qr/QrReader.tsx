import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material'
import { copyText } from '../../lib/clipboard'
import { captureFrame, decodeFrame, decodeImage, type DecodeResult, type Hit } from './decode'

const VALID_COLOR = '#00e676'
const ERROR_COLOR = '#ff5252'
const CAMERA_SUPPORTED = !!navigator.mediaDevices?.getUserMedia

function firstImage(data: DataTransfer | null): File | null {
  if (!data) return null
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  for (let i = 0; i < data.files.length; i++) {
    if (data.files[i].type.startsWith('image/')) return data.files[i]
  }
  return null
}

const isLink = (text: string) => /^(https?|mailto|tel|geo|sms):/i.test(text.trim())

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function describe(hit: Hit): string[] {
  return [
    hit.label,
    hit.version && `버전 ${hit.version}`,
    hit.eccLevel && `ECC ${hit.eccLevel}`,
    hit.orientation ? `${hit.orientation}° 회전` : '',
    hit.mirrored && '거울상',
    hit.inverted && '반전',
    `${hit.byteLength}바이트`,
  ].filter((v): v is string => !!v)
}

export default function QrReader() {
  const [source, setSource] = useState<{ file: File; url: string } | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [result, setResult] = useState<DecodeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState('')

  const overlayRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const urlRef = useRef('')
  // 뒤늦게 끝난 이전 디코딩이 새 결과를 덮지 않게 하는 표식입니다.
  const runRef = useRef(0)

  const show = useCallback((file: File | null, decoded: DecodeResult | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = file ? URL.createObjectURL(file) : ''
    setSource(file ? { file, url: urlRef.current } : null)
    setResult(decoded)
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const open = useCallback(
    (file: File | null) => {
      const run = ++runRef.current
      stopCamera()
      setError('')
      show(file, null)
      if (!file) {
        setBusy(false)
        return
      }
      setBusy(true)
      decodeImage(file)
        .then((decoded) => {
          if (runRef.current === run) setResult(decoded)
        })
        .catch((e: unknown) => {
          if (runRef.current !== run) return
          setResult(null)
          setError(message(e))
        })
        .finally(() => {
          if (runRef.current === run) setBusy(false)
        })
    },
    [show, stopCamera],
  )

  const startCamera = useCallback(async () => {
    runRef.current++
    setError('')
    setBusy(false)
    show(null, null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = media
      setStream(media)
    } catch (e) {
      setError(`카메라를 열 수 없습니다: ${message(e)}`)
    }
  }, [show])

  // 코드를 찾으면 그 프레임을 사진으로 남기고 카메라를 끕니다.
  useEffect(() => {
    const video = videoRef.current
    if (!stream || !video) return
    video.srcObject = stream
    void video.play().catch(() => undefined)

    let stopped = false
    let frame = 0
    const tick = async () => {
      if (stopped) return
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
        try {
          const decoded = await decodeFrame(video)
          if (stopped) return
          if (decoded.hits.some((hit) => hit.valid)) {
            const shot = await captureFrame(video)
            if (stopped) return
            stopCamera()
            show(shot, decoded)
            return
          }
        } catch (e) {
          if (stopped) return
          stopCamera()
          setError(message(e))
          return
        }
      }
      frame = requestAnimationFrame(() => void tick())
    }
    frame = requestAnimationFrame(() => void tick())

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      video.srcObject = null
    }
  }, [stream, show, stopCamera])

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  // 원본 좌표계로 그린 뒤 CSS로 미리보기 크기에 맞춥니다.
  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas || !result) return
    canvas.width = result.width
    canvas.height = result.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineWidth = Math.max(2, Math.round(Math.min(result.width, result.height) / 160))
    ctx.font = `bold ${Math.max(14, Math.round(Math.min(result.width, result.height) / 20))}px sans-serif`
    ctx.textBaseline = 'bottom'

    result.hits.forEach((hit, index) => {
      ctx.strokeStyle = hit.valid ? VALID_COLOR : ERROR_COLOR
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      hit.corners.forEach(({ x, y }, i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.stroke()
      const [topLeft] = hit.corners
      ctx.fillText(`${index + 1}`, topLeft.x, topLeft.y - ctx.lineWidth)
    })
  }, [result])

  // 페이지 어디에 놓거나 붙여넣어도 받도록 문서 단위로 듣습니다.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const image = firstImage(e.clipboardData)
      if (!image) return // 텍스트 붙여넣기는 흘려보냅니다
      e.preventDefault()
      open(image)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const image = firstImage(e.dataTransfer)
      if (image) open(image)
      else setError('이미지 파일을 찾을 수 없습니다')
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setDragging(true)
    }
    // 자식 위를 지날 때도 발생하므로, 창을 벗어난 경우만 거릅니다.
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }

    document.addEventListener('paste', onPaste)
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
    }
  }, [open])

  const copyHit = async (text: string) => {
    setToast((await copyText(text)) ? '복사했습니다' : '복사에 실패했습니다')
  }

  const found = result?.hits.filter((h) => h.valid) ?? []
  const failed = result?.hits.filter((h) => !h.valid) ?? []

  const zoneSx = {
    display: 'block',
    borderRadius: 2,
    border: '2px dashed',
    borderColor: dragging ? 'primary.main' : 'divider',
    bgcolor: dragging ? 'action.selected' : 'action.hover',
    p: source || stream ? 1 : 4,
    textAlign: 'center',
    transition: 'border-color .15s, background-color .15s',
  } as const

  return (
    <Stack spacing={2}>
      <input
        id="qr-reader-file"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null
          if (picked) open(picked)
          e.target.value = ''
        }}
      />

      <Card variant="outlined">
        <CardContent>
          {stream ? (
            <Box sx={zoneSx}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ display: 'block', width: '100%', borderRadius: 6 }}
              />
            </Box>
          ) : (
            <Box component="label" htmlFor="qr-reader-file" sx={{ ...zoneSx, cursor: 'pointer' }}>
              {source ? (
                <Box sx={{ position: 'relative', lineHeight: 0 }}>
                  <Box
                    component="img"
                    src={source.url}
                    alt="선택한 이미지"
                    sx={{ display: 'block', width: '100%', height: 'auto', borderRadius: 1.5 }}
                  />
                  <canvas
                    ref={overlayRef}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  />
                </Box>
              ) : (
                <Stack spacing={0.5}>
                  <Typography variant="body2">여기를 눌러 사진을 고르거나</Typography>
                  <Typography variant="body2">파일을 끌어다 놓거나</Typography>
                  <Typography variant="body2">Ctrl+V로 붙여넣어 주세요</Typography>
                </Stack>
              )}
            </Box>
          )}

          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="caption" color="text.secondary">
              {stream && '카메라로 찾는 중… 코드를 화면에 담아 주세요'}
              {busy && '읽는 중…'}
              {!stream && !busy && result &&
                `${result.width}×${result.height}px · ${result.elapsedMs.toFixed(0)}ms · 인식 ${found.length}개`}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 'none' }}>
              {(busy || stream) && <CircularProgress size={18} />}
              {CAMERA_SUPPORTED &&
                (stream ? (
                  <Button size="small" onClick={stopCamera}>
                    카메라 끄기
                  </Button>
                ) : (
                  <Button size="small" onClick={() => void startCamera()}>
                    카메라로 스캔
                  </Button>
                ))}
              {source && (
                <Button size="small" onClick={() => open(null)}>
                  지우기
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {found.map((hit, index) => (
        <Card key={`${hit.text}-${index}`} variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip label={index + 1} size="small" sx={{ bgcolor: VALID_COLOR, color: '#000' }} />
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  {describe(hit).map((tag) => (
                    <Chip key={tag} label={tag} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Stack>

              <Typography
                sx={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '.9rem',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  userSelect: 'text',
                }}
              >
                {hit.text}
              </Typography>

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" size="small" onClick={() => void copyHit(hit.text)}>
                  복사
                </Button>
                {isLink(hit.text) && (
                  <Button
                    variant="outlined"
                    size="small"
                    component="a"
                    href={hit.text.trim()}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    열기
                  </Button>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}

      {result && found.length === 0 && (
        <Alert severity="warning">
          인식된 코드가 없습니다. 코드가 잘리지 않고 초점이 맞은 사진인지 확인해 주세요.
        </Alert>
      )}

      {failed.length > 0 && (
        <Alert severity="info">
          <AlertTitle>읽다 실패한 심볼 {failed.length}개</AlertTitle>
          {failed.map((hit, index) => (
            <Typography key={index} variant="body2">
              {hit.label}: {hit.error || '알 수 없는 오류'}
            </Typography>
          ))}
        </Alert>
      )}

      <Snackbar
        open={!!toast}
        message={toast}
        autoHideDuration={1600}
        onClose={() => setToast('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  )
}
