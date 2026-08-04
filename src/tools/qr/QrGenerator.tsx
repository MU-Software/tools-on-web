import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

const ECC_LEVELS = [
  { value: 'L', label: 'L (7%)' },
  { value: 'M', label: 'M (15%)' },
  { value: 'Q', label: 'Q (25%)' },
  { value: 'H', label: 'H (30%)' },
] as const

type Ecl = (typeof ECC_LEVELS)[number]['value']

/** 조용한 영역 (모듈 단위) */
const QUIET = 4

function uuidv4(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function QrGenerator() {
  const [uuid, setUuid] = useState(uuidv4)
  const [ecl, setEcl] = useState<Ecl>('M')
  const [upper, setUpper] = useState(false)
  const [toast, setToast] = useState('')
  const [frameWidth, setFrameWidth] = useState(320)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const shown = upper ? uuid.toUpperCase() : uuid
  const qr = useMemo(() => QRCode.create(shown, { errorCorrectionLevel: ecl }), [shown, ecl])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(([entry]) => {
      setFrameWidth(entry.contentRect.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const size = qr.modules.size
    const total = size + QUIET * 2

    // 화면 픽셀 밀도에 맞춰 모듈당 정수 픽셀을 배정 → 흐릿함/모아레 방지
    const cssWidth = Math.min(Math.max(frameWidth - 24, 160), 320)
    const dpr = window.devicePixelRatio || 1
    const scale = Math.max(2, Math.floor((cssWidth * dpr) / total))
    const px = total * scale

    canvas.width = px
    canvas.height = px

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, px, px)
    ctx.fillStyle = '#000000'
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.data[y * size + x]) {
          ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale)
        }
      }
    }
  }, [qr, frameWidth])

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
    try {
      await navigator.clipboard.writeText(shown)
      setToast('복사했습니다')
    } catch {
      // 비보안 컨텍스트 폴백
      const ta = document.createElement('textarea')
      ta.value = shown
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      setToast(ok ? '복사했습니다' : '복사에 실패했습니다')
    }
  }

  const savePng = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) {
        setToast('저장에 실패했습니다')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `uuid-${uuid}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setToast('PNG를 저장했습니다')
    }, 'image/png')
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
              }}
            >
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`UUID ${shown} QR 코드`}
                style={{ width: '100%', maxWidth: 320, aspectRatio: '1 / 1' }}
              />
            </Box>
            <Typography
              sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '.85rem', wordBreak: 'break-all', textAlign: 'center' }}
            >
              {shown}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {`버전 ${qr.version} · ${qr.modules.size}×${qr.modules.size} · 오류정정 ${ecl} · 마스크 ${qr.maskPattern}`}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="contained" onClick={regenerate} sx={{ flexGrow: 1 }}>
          새 UUID 생성
        </Button>
        <Button variant="outlined" onClick={copyUuid}>
          UUID 복사
        </Button>
        <Button variant="outlined" onClick={savePng}>
          PNG 저장
        </Button>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
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
            <FormControlLabel
              control={<Switch checked={upper} onChange={(e) => setUpper(e.target.checked)} />}
              label="대문자로 표기"
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
