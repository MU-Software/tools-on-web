import { useEffect, useMemo, useRef, useState } from 'react'
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
import { FORMATS, GROUPS, toPayload } from './formats'

const ECC_LEVELS = [
  { value: 'L', label: 'L (7%)' },
  { value: 'M', label: 'M (15%)' },
  { value: 'Q', label: 'Q (25%)' },
  { value: 'H', label: 'H (30%)' },
] as const

type Ecl = (typeof ECC_LEVELS)[number]['value']

const MAX_WIDTH = 420
const MAX_LENGTH = 512

/** 저장 파일명에 쓸 수 있도록 내용을 다듬습니다. */
function slug(text: string): string {
  const s = text.trim().replace(/[^0-9A-Za-z가-힣._-]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, 40) || 'barcode'
}

export default function BarcodeGenerator() {
  const [text, setText] = useState(uuidv4)
  const [bcid, setBcid] = useState(FORMATS[0].bcid)
  const [ecl, setEcl] = useState<Ecl>('M')
  const [upper, setUpper] = useState(false)
  const [toast, setToast] = useState('')
  const [frameWidth, setFrameWidth] = useState(MAX_WIDTH)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const format = useMemo(() => FORMATS.find((f) => f.bcid === bcid) ?? FORMATS[0], [bcid])
  const payload = toPayload(text, upper, format)
  const groupLabel = GROUPS.find((g) => g.group === format.group)?.label ?? format.group

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
    if (!payload) return { width: 0, height: 0, error: '' }
    try {
      const probe = document.createElement('canvas')
      format.render(probe, { ...options, scale: 1 })
      return { width: probe.width, height: probe.height, error: '' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 'bwipp.ean13badLength#6878: EAN-13 must be ...' 같은 내부 접두어는 걷어낸다
      return { width: 0, height: 0, error: msg.replace(/^bwipp?[.\w]*#?\d*:\s*/, '') }
    }
  }, [format, options, payload])

  const ready = !!payload && !symbol.error

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !symbol.width) return

    const dpr = window.devicePixelRatio || 1
    const target = Math.min(Math.max(frameWidth - 24, 160), MAX_WIDTH)
    const scale = Math.max(1, Math.floor((target * dpr) / symbol.width))

    format.render(canvas, { ...options, scale })
    canvas.style.width = `${canvas.width / dpr}px`
  }, [format, options, symbol.width, frameWidth])

  const copyValue = async () => {
    setToast((await copyText(payload)) ? '복사했습니다' : '복사에 실패했습니다')
  }

  const savePng = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) {
        setToast('저장에 실패했습니다')
        return
      }
      downloadBlob(blob, `${format.bcid}-${slug(payload)}.png`)
      setToast('PNG를 저장했습니다')
    }, 'image/png')
  }

  const saveSvg = () => {
    try {
      const svg = format.render({ ...options, scale: 2 }, drawingSVG())
      downloadBlob(
        new Blob([svg], { type: 'image/svg+xml' }),
        `${format.bcid}-${slug(payload)}.svg`,
      )
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
                bgcolor: ready ? '#fff' : 'action.hover',
                borderRadius: 2,
                p: 1.5,
                minHeight: 140,
              }}
            >
              {symbol.error ? (
                <Alert severity="error" sx={{ width: '100%' }}>
                  이 포맷으로 인코딩할 수 없습니다: {symbol.error}
                </Alert>
              ) : !payload ? (
                <Typography variant="body2" color="text.secondary">
                  변환할 내용을 입력하세요
                </Typography>
              ) : (
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label={`${format.label} 바코드: ${payload.slice(0, 64)}`}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              {`${format.label} · ${groupLabel} · ${payload.length}자`}
              {ready && ` · 기본 크기 ${symbol.width}×${symbol.height}px`}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <TextField
        value={text}
        onChange={(e) => setText(e.target.value)}
        label="내용"
        placeholder="바코드로 만들 문자열"
        multiline
        maxRows={5}
        fullWidth
        slotProps={{
          htmlInput: { maxLength: MAX_LENGTH, spellCheck: false, autoCapitalize: 'off' },
          input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: '.9rem' } },
        }}
        helperText={`${text.length} / ${MAX_LENGTH}자`}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => setText(uuidv4())} sx={{ flexGrow: 1 }}>
          임의 UUID 생성
        </Button>
        <Button variant="outlined" onClick={copyValue} disabled={!payload} sx={{ flexGrow: 1 }}>
          내용 복사
        </Button>
        <Button variant="outlined" onClick={savePng} disabled={!ready} sx={{ flexGrow: 1 }}>
          PNG 저장
        </Button>
        <Button variant="outlined" onClick={saveSvg} disabled={!ready} sx={{ flexGrow: 1 }}>
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
              {GROUPS.flatMap((g) => [
                <ListSubheader key={g.group}>{g.label}</ListSubheader>,
                ...FORMATS.filter((f) => f.group === g.group).map((f) => (
                  <MenuItem key={f.bcid} value={f.bcid}>
                    {f.label}
                  </MenuItem>
                )),
              ])}
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
                  ? `대문자로 변환 (${format.label}은 대문자만 지원)`
                  : '대문자로 변환'
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
