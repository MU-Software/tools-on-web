import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import { RulerCanvas } from './RulerCanvas'
import type { Axis } from './draw'
import {
  CARD_MM,
  MM_PER_INCH,
  clearPpi,
  cssPxPerMm,
  diagonalInch,
  loadPpi,
  ppiFromCssPxPerMm,
  ppiFromDiagonal,
  readScreen,
  savePpi,
  useDevicePixelRatio,
} from './calibration'
import { DEVICE_DB_DATE, PRESETS, detectDisplay, presetPpi, readModel } from './devices'

type Method = 'device' | 'card' | 'diagonal' | 'manual'

const PREVIEW_THICKNESS = 108
const PREVIEW_AREA = 340
const FULLSCREEN_THICKNESS = 132
const CARD_RATIO = CARD_MM.short / CARD_MM.long

const AXES: { value: Axis; label: string }[] = [
  { value: 'h', label: '가로' },
  { value: 'v', label: '세로' },
  { value: 'd', label: '대각선' },
]

const CONFIDENCE = { high: '정확도 높음', medium: '계열만 일치', low: '넘겨짚은 값' } as const

const numeric = (text: string) => {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

export default function ScreenRuler() {
  const dpr = useDevicePixelRatio()
  const info = useMemo(() => readScreen(dpr), [dpr])
  const [model, setModel] = useState('')
  const detected = useMemo(() => detectDisplay(info, dpr, model), [info, dpr, model])

  // 보정 전에는 감지값을 그대로 쓴다
  const [savedPpi, setSavedPpi] = useState(loadPpi)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [method, setMethod] = useState<Method>('device')
  const [cardVertical, setCardVertical] = useState(() => window.innerWidth < 560)
  const [diagText, setDiagText] = useState('')
  const [ppiText, setPpiText] = useState('')
  const [axis, setAxis] = useState<Axis>('h')
  const [marker, setMarker] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const cardAreaRef = useRef<HTMLDivElement>(null)
  const [cardAreaWidth, setCardAreaWidth] = useState(0)

  // 모델명은 UA Client Hints라 비동기다. 도착하면 아직 보정 전인 값만 다시 잡는다.
  useEffect(() => {
    let alive = true
    void readModel().then((value) => alive && setModel(value))
    return () => {
      alive = false
    }
  }, [])

  const ppi = savedPpi ?? detected.ppi
  const calibrated = savedPpi != null
  const presetId = pickedId ?? detected.presetId
  const perMm = cssPxPerMm(ppi, dpr)

  useEffect(() => {
    const area = cardAreaRef.current
    if (!area) return
    const observer = new ResizeObserver(([entry]) => setCardAreaWidth(entry.contentRect.width))
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  // Esc 등으로 브라우저 전체 화면이 풀리면 오버레이도 함께 닫는다
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const applyPpi = (next: number) => {
    const clamped = Math.min(Math.max(next, 30), 1200)
    setSavedPpi(clamped)
    savePpi(clamped)
  }

  const useDetected = () => {
    clearPpi()
    setSavedPpi(null)
    setPickedId(null)
  }

  const selectMethod = (next: Method | null) => {
    if (!next) return
    if (next === 'diagonal') setDiagText(diagonalInch(ppi, info).toFixed(1))
    if (next === 'manual') setPpiText(ppi.toFixed(0))
    setMethod(next)
  }

  const selectPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    setPickedId(id)
    applyPpi(presetPpi(preset, dpr, info))
  }

  const changeAxis = (next: Axis | null) => {
    if (!next) return
    setAxis(next)
    setMarker(null)
  }

  const openFullscreen = async () => {
    setFullscreen(true)
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      /* 브라우저가 막으면 오버레이만으로 동작한다 */
    }
  }

  const closeFullscreen = () => {
    setFullscreen(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  const cardEdgeMm = cardVertical ? CARD_MM.short : CARD_MM.long
  const cardWidth = Math.round(perMm * cardEdgeMm)
  const cardMin = Math.round(cardEdgeMm * 2)
  const cardMax = Math.max(
    Math.round(cardEdgeMm * 3),
    Math.min(Math.round(cardEdgeMm * 10), Math.floor(cardAreaWidth) || 9999),
  )

  const measured = marker == null ? null : marker / perMm

  const axisPicker = (size: 'small' | 'medium') => (
    <ToggleButtonGroup exclusive size={size} value={axis} onChange={(_, next: Axis | null) => changeAxis(next)}>
      {AXES.map((item) => (
        <ToggleButton key={item.value} value={item.value} sx={{ px: 1.5 }}>
          {item.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )

  const ruler = (thickness: number) => (
    <RulerCanvas
      axis={axis}
      pxPerMm={perMm}
      dpr={dpr}
      thickness={thickness}
      marker={marker}
      onMarker={setMarker}
    />
  )

  const readout = (
    <Typography variant="body2" color="text.secondary">
      {measured == null
        ? '자를 누르거나 끌면 그 지점까지의 길이를 표시합니다.'
        : `측정 ${measured.toFixed(1)} mm · ${(measured / 10).toFixed(2)} cm · ${(measured / MM_PER_INCH).toFixed(2)} in`}
    </Typography>
  )

  return (
    <Stack spacing={2}>
      {!calibrated && (
        <Alert severity="info">
          브라우저는 실제 화면 밀도를 알려주지 않아, 지금 값은 <b>{detected.label}</b>으로 추정한
          것입니다({CONFIDENCE[detected.confidence]}). 정확히 재려면 아래에서 한 번 보정하세요.
        </Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip
                size="small"
                color={calibrated ? 'primary' : 'default'}
                label={`${calibrated ? '보정됨' : '추정'} ${ppi.toFixed(0)} PPI`}
              />
              <Typography variant="caption" color="text.secondary">
                1mm = {perMm.toFixed(2)}px
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              {axisPicker('small')}
              <IconButton size="small" onClick={openFullscreen} aria-label="전체 화면">
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Box
              sx={{
                height: axis === 'h' ? PREVIEW_THICKNESS : PREVIEW_AREA,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              {ruler(PREVIEW_THICKNESS)}
            </Box>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {readout}
              <Box sx={{ flexGrow: 1 }} />
              {measured != null && (
                <Button size="small" onClick={() => setMarker(null)}>
                  지우기
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle2">화면 밀도 보정</Typography>

            <ToggleButtonGroup
              exclusive
              size="small"
              value={method}
              onChange={(_, next: Method | null) => selectMethod(next)}
              fullWidth
            >
              <ToggleButton value="device">장치</ToggleButton>
              <ToggleButton value="card">신용카드</ToggleButton>
              <ToggleButton value="diagonal">화면 크기</ToggleButton>
              <ToggleButton value="manual">직접 입력</ToggleButton>
            </ToggleButtonGroup>

            {method === 'device' && (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  감지 결과: <b>{detected.label}</b> · {detected.ppi.toFixed(0)} PPI (
                  {CONFIDENCE[detected.confidence]})
                </Typography>
                <Autocomplete
                  size="small"
                  options={PRESETS}
                  groupBy={(option) => option.group}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  value={PRESETS.find((p) => p.id === presetId) ?? null}
                  onChange={(_, next) => next && selectPreset(next.id)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="장치 선택"
                      helperText={`${PRESETS.length}대 수록 · DB 기준일 ${DEVICE_DB_DATE}`}
                    />
                  )}
                />
                <Typography variant="caption" color="text.secondary">
                  해상도·배율·모델명으로 기기를 추려낸 값입니다. macOS처럼 배율을 바꿀 수 있는
                  화면은 CSS 픽셀이 실제 픽셀과 1:1이 아니라서, 지금 해상도에 맞춰 환산한 값을
                  씁니다. 화면비가 비슷한 모델끼리는 헷갈리고, 브라우저 확대·축소를 켠 채로 열면
                  OS 배율과 구분되지 않으니, 정확히 재려면 신용카드로 보정하세요.
                </Typography>
              </Stack>
            )}

            {method === 'card' && (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  신용카드나 주민등록증을 화면에 대고, 아래 사각형이 실물과 같아질 때까지 조절하세요.
                </Typography>
                <Box ref={cardAreaRef} sx={{ width: '100%', overflow: 'hidden' }}>
                  <Box
                    sx={{
                      width: cardWidth,
                      height: Math.round(cardWidth * (cardVertical ? 1 / CARD_RATIO : CARD_RATIO)),
                      maxWidth: '100%',
                      border: '2px solid',
                      borderColor: 'primary.main',
                      borderRadius: `${Math.max(4, perMm * 3)}px`,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {cardEdgeMm} mm
                    </Typography>
                  </Box>
                </Box>
                <Slider
                  value={Math.min(Math.max(cardWidth, cardMin), cardMax)}
                  min={cardMin}
                  max={cardMax}
                  step={1}
                  onChange={(_, value) =>
                    applyPpi(ppiFromCssPxPerMm((value as number) / cardEdgeMm, dpr))
                  }
                  aria-label="카드 크기 맞추기"
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => applyPpi(ppiFromCssPxPerMm((cardWidth - 1) / cardEdgeMm, dpr))}
                  >
                    −1px
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => applyPpi(ppiFromCssPxPerMm((cardWidth + 1) / cardEdgeMm, dpr))}
                  >
                    +1px
                  </Button>
                  <Box sx={{ flexGrow: 1 }} />
                  <Button size="small" onClick={() => setCardVertical((v) => !v)}>
                    카드 {cardVertical ? '가로로' : '세로로'}
                  </Button>
                </Stack>
              </Stack>
            )}

            {method === 'diagonal' && (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  이 화면의 대각선 크기를 입력하면 {info.deviceWidth}×{info.deviceHeight} 해상도로
                  밀도를 계산합니다.
                </Typography>
                <TextField
                  value={diagText}
                  onChange={(e) => {
                    setDiagText(e.target.value)
                    const inch = numeric(e.target.value)
                    if (inch && inch >= 3 && inch <= 120) applyPpi(ppiFromDiagonal(inch, info))
                  }}
                  label="화면 대각선"
                  size="small"
                  type="number"
                  slotProps={{ htmlInput: { step: 0.1, min: 3, max: 120 } }}
                  helperText="인치. 노트북·모니터 사양에 적힌 값입니다"
                />
              </Stack>
            )}

            {method === 'manual' && (
              <TextField
                value={ppiText}
                onChange={(e) => {
                  setPpiText(e.target.value)
                  const value = numeric(e.target.value)
                  if (value) applyPpi(value)
                }}
                label="화면 밀도 (PPI)"
                size="small"
                type="number"
                slotProps={{ htmlInput: { step: 1, min: 30, max: 1200 } }}
                helperText="물리 픽셀 기준 값입니다"
              />
            )}

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" onClick={useDetected} disabled={!calibrated}>
                감지값으로 되돌리기
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="caption" color="text.secondary">
                A4 용지 210×297mm로 확인해 보세요
              </Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" gutterBottom>
              화면 정보
            </Typography>
            <Info label="감지된 장치" value={detected.label} />
            <Info label="논리 해상도" value={`${info.cssWidth} × ${info.cssHeight} CSS px`} />
            <Info
              label="물리 픽셀"
              value={`${info.deviceWidth} × ${info.deviceHeight} px (배율 ×${dpr.toFixed(2)})`}
            />
            <Info
              label="화면 밀도"
              value={`${ppi.toFixed(1)} PPI · CSS 기준 ${(ppi / dpr).toFixed(1)} dpi`}
            />
            <Info label="대각선 추정" value={`${diagonalInch(ppi, info).toFixed(1)} 인치`} />
          </Stack>
        </CardContent>
      </Card>

      {fullscreen && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (t) => t.zIndex.modal,
            bgcolor: 'background.default',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              ...(axis === 'h' && { top: 0, left: 0, right: 0 }),
              ...(axis === 'v' && { top: 0, bottom: 0, left: 0 }),
              ...(axis === 'd' && { inset: 0 }),
            }}
          >
            {ruler(FULLSCREEN_THICKNESS)}
          </Box>

          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              alignItems: 'center',
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              boxShadow: 4,
              px: 1.5,
              py: 1,
            }}
          >
            {readout}
            {axisPicker('small')}
            <IconButton size="small" onClick={closeFullscreen} aria-label="전체 화면 닫기">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      )}
    </Stack>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace' }}>
        {value}
      </Typography>
    </Stack>
  )
}
