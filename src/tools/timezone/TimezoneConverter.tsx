import { useEffect, useState } from 'react'
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { copyText } from '../../lib/clipboard'
import {
  DEFAULT_ZONES,
  LOCAL_ZONE,
  ZONES,
  cityLabel,
  dayShift,
  diffLabel,
  formatDate,
  formatTime,
  fromInputValue,
  offsetLabel,
  toInputValue,
  zoneName,
} from './zones'

const STORAGE_KEY = 'tools-on-web.timezones'

function loadZones(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')
    if (Array.isArray(saved) && saved.every((z) => typeof z === 'string')) {
      const known = saved.filter((z) => ZONES.includes(z))
      if (known.length) return known
    }
  } catch {
    /* 저장값이 깨졌으면 기본값으로 시작한다 */
  }
  return DEFAULT_ZONES
}

const DAY_SHIFT: Record<number, string> = { [-2]: '그저께', [-1]: '어제', 1: '내일', 2: '모레' }

export default function TimezoneConverter() {
  const [live, setLive] = useState(true)
  const [baseZone, setBaseZone] = useState(LOCAL_ZONE)
  const [instant, setInstant] = useState(() => Date.now())
  const [zones, setZones] = useState(loadZones)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setInstant(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(zones))
  }, [zones])

  const changeInput = (text: string) => {
    const next = fromInputValue(text, baseZone)
    if (next == null) return
    setLive(false)
    setInstant(next)
  }

  const now = () => {
    setInstant(Date.now())
    setLive(true)
  }

  const addZone = (tz: string | null) => {
    if (!tz || zones.includes(tz)) return
    setZones([...zones, tz])
  }

  const copyRow = async (tz: string) => {
    const line = `${formatDate(instant, tz)} ${formatTime(instant, tz)} (${offsetLabel(instant, tz)}, ${tz})`
    setToast((await copyText(line)) ? '복사했습니다' : '복사하지 못했습니다')
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">기준 시각</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <FormControlLabel
                control={<Switch size="small" checked={live} onChange={(e) => setLive(e.target.checked)} />}
                label={<Typography variant="body2">현재 시각 따라가기</Typography>}
              />
              <Button size="small" onClick={now}>
                지금
              </Button>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                value={toInputValue(instant, baseZone)}
                onChange={(e) => changeInput(e.target.value)}
                label="날짜와 시각"
                type="datetime-local"
                size="small"
                slotProps={{ htmlInput: { step: 1 } }}
                sx={{ flex: 1 }}
              />
              <Autocomplete
                size="small"
                options={ZONES}
                value={baseZone}
                onChange={(_, next) => next && setBaseZone(next)}
                disableClearable
                sx={{ flex: 1.2 }}
                renderInput={(params) => <TextField {...params} label="기준 시간대" />}
              />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              {zoneName(instant, baseZone)} · {offsetLabel(instant, baseZone)} · 유닉스{' '}
              {Math.floor(instant / 1000)}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
            {zones.map((tz) => {
              const shift = dayShift(instant, baseZone, tz)
              return (
                <Stack
                  key={tz}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', px: 2, py: 1.5 }}
                >
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: '.95rem', fontWeight: 650 }}>
                        {cityLabel(tz)}
                      </Typography>
                      <Chip size="small" variant="outlined" label={offsetLabel(instant, tz)} />
                      {tz === baseZone ? (
                        <Chip size="small" color="primary" label="기준" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {diffLabel(instant, baseZone, tz)}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                      {tz} · {zoneName(instant, tz)}
                    </Typography>
                  </Box>

                  <Box sx={{ textAlign: 'right' }}>
                    <Typography
                      onClick={() => copyRow(tz)}
                      sx={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '1.15rem',
                        cursor: 'pointer',
                      }}
                    >
                      {formatTime(instant, tz)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(instant, tz)}
                      {shift !== 0 && ` · ${DAY_SHIFT[shift] ?? `${shift > 0 ? '+' : ''}${shift}일`}`}
                    </Typography>
                  </Box>

                  <IconButton
                    size="small"
                    onClick={() => setZones(zones.filter((z) => z !== tz))}
                    aria-label={`${tz} 지우기`}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )
            })}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Autocomplete
              size="small"
              options={ZONES.filter((z) => !zones.includes(z))}
              value={null}
              onChange={(_, next) => addZone(next)}
              blurOnSelect
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="시간대 추가"
                  helperText={`${ZONES.length}개 · 목록은 브라우저에 저장됩니다`}
                />
              )}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setZones(DEFAULT_ZONES)}>
                기본 목록으로
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Snackbar open={!!toast} message={toast} autoHideDuration={1800} onClose={() => setToast('')} />
    </Stack>
  )
}
