import { useMemo, useState } from 'react'
import {
  Box,
  ButtonBase,
  Card,
  CardContent,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { copyText } from '../../lib/clipboard'
import { CATEGORIES, formatValue, parseValue, rawValue } from './units'

export default function UnitConverter() {
  const [catId, setCatId] = useState(CATEGORIES[0].id)
  const [unitId, setUnitId] = useState(CATEGORIES[0].units[0].id)
  const [text, setText] = useState('1')
  const [toast, setToast] = useState('')

  const category = CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0]
  const unit = category.units.find((u) => u.id === unitId) ?? category.units[0]
  const value = parseValue(text)

  const rows = useMemo(() => {
    if (value == null) return []
    const base = unit.toBase(value)
    return category.units.map((u) => ({ unit: u, result: u.fromBase(base) }))
  }, [category, unit, value])

  const selectCategory = (id: string) => {
    const next = CATEGORIES.find((c) => c.id === id)
    if (!next) return
    setCatId(id)
    setUnitId(next.units[0].id)
  }

  const copy = async (u: (typeof category.units)[number], result: number) => {
    const raw = rawValue(result)
    setToast((await copyText(raw)) ? `복사: ${raw} ${u.symbol}` : '복사하지 못했습니다')
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <Tabs
          value={catId}
          onChange={(_, next: string) => selectCategory(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {CATEGORIES.map((c) => (
            <Tab key={c.id} value={c.id} label={c.label} />
          ))}
        </Tabs>

        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              value={text}
              onChange={(e) => setText(e.target.value)}
              label="값"
              size="small"
              error={text.trim() !== '' && value == null}
              helperText={text.trim() !== '' && value == null ? '숫자를 입력하세요' : ' '}
              slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
              sx={{ flex: 1 }}
            />
            <TextField
              value={unit.id}
              onChange={(e) => setUnitId(e.target.value)}
              label="단위"
              size="small"
              select
              helperText=" "
              sx={{ minWidth: 200 }}
            >
              {category.units.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.label} ({u.symbol})
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 5 }}>
              변환할 값을 입력하세요
            </Typography>
          ) : (
            <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
              {rows.map(({ unit: u, result }) => {
                const source = u.id === unit.id
                return (
                  <ButtonBase
                    key={u.id}
                    onClick={() => copy(u, result)}
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 1.5,
                      px: 2,
                      py: 1.25,
                      textAlign: 'left',
                      bgcolor: source ? 'action.selected' : undefined,
                    }}
                  >
                    <Typography sx={{ minWidth: 76, fontSize: '.9rem', fontWeight: 650 }}>
                      {u.symbol}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '.78rem' }}>
                      {u.label}
                    </Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Typography
                      sx={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '.95rem',
                        wordBreak: 'break-all',
                      }}
                    >
                      {formatValue(result)}
                    </Typography>
                  </ButtonBase>
                )
              })}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary">
        값을 누르면 클립보드에 복사합니다. 표시는 유효숫자 12자리로 반올림하며, 복사되는 값도
        같습니다.
      </Typography>

      <Snackbar
        open={!!toast}
        message={toast}
        autoHideDuration={1800}
        onClose={() => setToast('')}
      />
    </Stack>
  )
}
