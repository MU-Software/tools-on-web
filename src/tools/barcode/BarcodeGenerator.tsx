import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drawingSVG, type RenderOptions } from 'bwip-js/browser'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { uuidv4 } from '../../lib/uuid'
import { copyText } from '../../lib/clipboard'
import { downloadBlob } from '../../lib/download'
import { FORMATS, toPayload, type Encoding } from './formats'

const ECC_LEVELS = [
  { value: 'L', label: 'L (7%)' },
  { value: 'M', label: 'M (15%)' },
  { value: 'Q', label: 'Q (25%)' },
  { value: 'H', label: 'H (30%)' },
] as const

type Ecl = (typeof ECC_LEVELS)[number]['value']

const ENCODINGS: { value: Encoding; label: string }[] = [
  { value: 'hyphen', label: '표준 표기 (36자, 하이픈 포함)' },
  { value: 'plain', label: '하이픈 제거 (32자)' },
]

const MAX_WIDTH = 420

export default function BarcodeGenerator() {
  const [uuid, setUuid] = useState(uuidv4)
  const [bcid, setBcid] = useState(FORMATS[0].bcid)
  const [encoding, setEncoding] = useState<Encoding>('hyphen')
  const [ecl, setEcl] = useState<Ecl>('M')
  const [upper, setUpper] = useState(false)
  const [toast, setToast] = useState('')
  const [frameWidth, setFrameWidth] = useState(MAX_WIDTH)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const format = useMemo(() => FORMATS.find((f) => f.bcid === bcid) ?? FORMATS[0], [bcid])
  const payload = toPayload(uuid, encoding, upper, format)

  const options = useMemo<RenderOptions>(
    () => ({
      bcid: format.bcid,
      text: payload,
      ...format.opts,
      ...(format.bcid === 'qrcode' ? { eclevel: ecl } : {}),
    }),
    [format, payload, ecl],
  )

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  // 심볼의 자연 크기를 미리 재 두고, 모듈이 정수 픽셀에 떨어지도록 배율을 정한다
  const symbol = useMemo(() => {
    try {
      const probe = document.createElement('canvas')
      format.render(probe, { ...options, scale: 1 })
      return { width: probe.width, height: probe.height, error: '' }
    } catch (e) {
      return { width: 0, height: 0, error: e instanceof Error ? e.message : String(e) }
    }
  }, [format, options])

  const error = symbol.error

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !symbol.width) return

    const dpr = window.devicePixelRatio || 1
    const target = Math.min(Math.max(frameWidth - 24, 160), MAX_WIDTH)
    const scale = Math.max(1, Math.floor((target * dpr) / symbol.width))

    format.render(canvas, { ...options, scale })
    canvas.style.width = `${canvas.width / dpr}px`
  }, [format, options, symbol.width, frameWidth])

  const regenerate = useCallback(() => setUuid(uuidv4()), [])

  // 스페이스바 / 엔터로 재생성
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.matches('button, select, input, textarea')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        regenerate()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [regenerate])

  const copyUuid = async () => {
    setToast((await copyText(payload)) ? '복사했습니다' : '복사에 실패했습니다')
  }

  const savePng = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) {
        setToast('저장에 실패했습니다')
        return
      }
      downloadBlob(blob, `${format.bcid}-${uuid}.png`)
      setToast('PNG를 저장했습니다')
    }, 'image/png')
  }

  const saveSvg = () => {
    try {
      const svg = format.render({ ...options, scale: 2 }, drawingSVG())
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${format.bcid}-${uuid}.svg`)
      setToast('SVG를 저장했습니다')
    } catch {
      setToast('저장에 실패했습니다')
    }
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box
              ref={frameRef}
              sx={{
                width: '100%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: '#fff',
                borderRadius: 2,
                p: 1.5,
                minHeight: 120,
              }}
            >
              {error ? (
                <Alert severity="error" sx={{ width: '100%' }}>
                  이 포맷으로 인코딩할 수 없습니다: {error}
                </Alert>
              ) : (
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label={`UUID ${payload} ${format.label} 바코드`}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              )}
            </Box>
            <Typography
              sx={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '.85rem',
                wordBreak: 'break-all',
                textAlign: 'center',
              }}
            >
              {payload}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              {`${format.label} · ${format.kind} · ${payload.length}자`}
              {!error && ` · 기본 크기 ${symbol.width}×${symbol.height}px`}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="contained" onClick={regenerate} sx={{ flexGrow: 1 }}>
          새 UUID 생성
        </Button>
        <Button variant="outlined" onClick={copyUuid}>
          값 복사
        </Button>
        <Button variant="outlined" onClick={savePng} disabled={!!error}>
          PNG 저장
        </Button>
        <Button variant="outlined" onClick={saveSvg} disabled={!!error}>
          SVG 저장
        </Button>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label="바코드 포맷"
              value={bcid}
              onChange={(e) => setBcid(e.target.value)}
              size="small"
              helperText={format.desc}
            >
              <ListSubheader>2D</ListSubheader>
              {FORMATS.filter((f) => f.kind === '2D').map((f) => (
                <MenuItem key={f.bcid} value={f.bcid}>
                  {f.label}
                </MenuItem>
              ))}
              <ListSubheader>1D</ListSubheader>
              {FORMATS.filter((f) => f.kind === '1D').map((f) => (
                <MenuItem key={f.bcid} value={f.bcid}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="UUID 표기"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as Encoding)}
              size="small"
            >
              {ENCODINGS.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>

            {format.bcid === 'qrcode' && (
              <TextField
                select
                label="오류 정정 레벨"
                value={ecl}
                onChange={(e) => setEcl(e.target.value as Ecl)}
                size="small"
              >
                {ECC_LEVELS.map((level) => (
                  <MenuItem key={level.value} value={level.value}>
                    {level.label}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={upper || !!format.upperOnly}
                  disabled={!!format.upperOnly}
                  onChange={(e) => setUpper(e.target.checked)}
                />
              }
              label={
                format.upperOnly
                  ? `대문자로 표기 (${format.label}은 대문자만 지원)`
                  : '대문자로 표기'
              }
            />
          </Stack>
        </CardContent>
      </Card>

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
