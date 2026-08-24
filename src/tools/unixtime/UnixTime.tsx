import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { copyText } from '../../lib/clipboard'
import {
  SCALES,
  type Scale,
  formatIn,
  fromLocalInput,
  fromMs,
  localIso,
  parseInput,
  relativeLabel,
  toLocalInput,
} from './parse'

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export default function UnixTime() {
  const [now, setNow] = useState(() => Date.now())
  const [live, setLive] = useState(true)
  const [text, setText] = useState(() => String(Math.floor(Date.now() / 1000)))
  const [scale, setScale] = useState<Scale | 'auto'>('auto')
  const [dateText, setDateText] = useState(() => toLocalInput(Date.now(), false))
  const [dateUtc, setDateUtc] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 50)
    return () => clearInterval(id)
  }, [live])

  const copy = async (value: string, what: string) => {
    setToast((await copyText(value)) ? `${what} 복사` : '복사하지 못했습니다')
  }

  const parsed = parseInput(text, scale)
  const encoded = fromLocalInput(dateText, dateUtc)

  const fillNow = () => {
    setText(String(Math.floor(Date.now() / 1000)))
    setScale('auto')
  }

  const changeBase = (utc: boolean) => {
    // 표시 기준만 바꾸고 가리키는 시점은 유지한다
    if (encoded != null) setDateText(toLocalInput(encoded, utc))
    setDateUtc(utc)
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">현재 유닉스 시간</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <FormControlLabel
                control={
                  <Switch size="small" checked={live} onChange={(e) => setLive(e.target.checked)} />
                }
                label={<Typography variant="body2">실시간</Typography>}
              />
            </Stack>

            <Clock
              label="초"
              value={String(Math.floor(now / 1000))}
              big
              onCopy={() => copy(String(Math.floor(now / 1000)), '초')}
            />
            <Clock label="밀리초" value={String(now)} onCopy={() => copy(String(now), '밀리초')} />

            <Typography variant="body2" color="text.secondary">
              {formatIn(now, false)} · {LOCAL_ZONE}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">유닉스 시간 → 날짜</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" onClick={fillNow}>
                지금
              </Button>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                value={text}
                onChange={(e) => setText(e.target.value)}
                label="타임스탬프 또는 날짜 문자열"
                size="small"
                error={text.trim() !== '' && !parsed}
                helperText={
                  text.trim() !== '' && !parsed
                    ? '읽을 수 없는 값입니다'
                    : '1700000000, 1700000000000, 2023-11-15T07:33:20Z 모두 가능합니다'
                }
                slotProps={{ htmlInput: { autoComplete: 'off', spellCheck: false } }}
                sx={{ flex: 1 }}
              />
              <TextField
                value={scale}
                onChange={(e) => setScale(e.target.value as Scale | 'auto')}
                label="단위"
                size="small"
                select
                helperText=" "
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="auto">자동</MenuItem>
                {SCALES.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            {parsed && (
              <Stack spacing={0.5}>
                {parsed.scale && scale === 'auto' && (
                  <Box sx={{ pb: 0.5 }}>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${SCALES.find((s) => s.value === parsed.scale)?.label}로 읽음`}
                    />
                  </Box>
                )}
                <Row label={`로컬 (${LOCAL_ZONE})`} value={formatIn(parsed.ms, false)} onCopy={copy} />
                <Row label="UTC" value={formatIn(parsed.ms, true)} onCopy={copy} />
                <Row label="ISO 8601 (로컬)" value={localIso(parsed.ms)} onCopy={copy} />
                <Row label="ISO 8601 (UTC)" value={new Date(parsed.ms).toISOString()} onCopy={copy} />
                <Row label="상대" value={relativeLabel(parsed.ms - now)} onCopy={copy} />
                <Row label="초" value={String(Math.floor(parsed.ms / 1000))} onCopy={copy} />
                <Row label="밀리초" value={String(Math.round(parsed.ms))} onCopy={copy} />
                <Row label="마이크로초" value={String(Math.round(fromMs(parsed.ms, 'us')))} onCopy={copy} />
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle2">날짜 → 유닉스 시간</Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
                label="날짜와 시각"
                type="datetime-local"
                size="small"
                slotProps={{ htmlInput: { step: 1 } }}
                sx={{ flex: 1 }}
              />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={dateUtc ? 'utc' : 'local'}
                onChange={(_, next: string | null) => next && changeBase(next === 'utc')}
              >
                <ToggleButton value="local">로컬</ToggleButton>
                <ToggleButton value="utc">UTC</ToggleButton>
              </ToggleButtonGroup>
              <Button size="small" onClick={() => setDateText(toLocalInput(Date.now(), dateUtc))}>
                지금
              </Button>
            </Stack>

            {encoded != null && (
              <Stack spacing={0.5}>
                <Row label="초" value={String(Math.floor(encoded / 1000))} onCopy={copy} />
                <Row label="밀리초" value={String(encoded)} onCopy={copy} />
                <Row label="ISO 8601 (UTC)" value={new Date(encoded).toISOString()} onCopy={copy} />
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Snackbar open={!!toast} message={toast} autoHideDuration={1800} onClose={() => setToast('')} />
    </Stack>
  )
}

function Clock({
  label,
  value,
  big,
  onCopy,
}: {
  label: string
  value: string
  big?: boolean
  onCopy: () => void
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 56 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: big ? '1.9rem' : '1.05rem',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <IconButton size="small" onClick={onCopy} aria-label={`${label} 복사`}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

function Row({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: (value: string, what: string) => void
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 'none', minWidth: 140 }}>
        {label}
      </Typography>
      <Typography
        onClick={() => onCopy(value, label)}
        sx={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: '.9rem',
          wordBreak: 'break-all',
          cursor: 'pointer',
          textAlign: 'right',
          flexGrow: 1,
        }}
      >
        {value}
      </Typography>
    </Stack>
  )
}
