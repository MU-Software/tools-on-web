import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import UsbIcon from '@mui/icons-material/Usb'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import { useEspUsb } from '../hooks/useEspUsb'

type Encoding = 'utf8' | 'hex'

function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length % 2 !== 0) throw new Error('hex 길이가 짝수가 아닙니다.')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function EspUsb() {
  const { status, device, endpoints, log, request, open, close, send, clearLog } = useEspUsb()
  const [vid, setVid] = useState('0x303a')
  const [pid, setPid] = useState('')
  const [text, setText] = useState('hello serial\n')
  const [encoding, setEncoding] = useState<Encoding>('utf8')
  const [busy, setBusy] = useState(false)

  const onRequest = async () => {
    setBusy(true)
    try {
      const filters: USBDeviceFilter[] = []
      const v = vid.trim()
      const p = pid.trim()
      if (v) {
        const filter: USBDeviceFilter = { vendorId: parseInt(v, 16) }
        if (p) filter.productId = parseInt(p, 16)
        filters.push(filter)
      }
      await request(filters)
    } finally {
      setBusy(false)
    }
  }

  const onOpen = async () => {
    setBusy(true)
    try {
      await open()
    } catch {
      /* logged */
    } finally {
      setBusy(false)
    }
  }

  const onSend = async () => {
    setBusy(true)
    try {
      const payload = encoding === 'hex' ? hexToBytes(text) : text
      await send(payload)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const isOpen = status === 'open'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="h6">ESP32-S3 WebUSB 송수신</Typography>
          <Chip
            size="small"
            label={status}
            color={
              status === 'error'
                ? 'error'
                : status === 'open'
                  ? 'success'
                  : status === 'opening' || status === 'requesting'
                    ? 'warning'
                    : 'default'
            }
          />
          {device && (
            <Chip
              size="small"
              variant="outlined"
              label={`${device.productName ?? 'USB Device'} · VID 0x${device.vendorId
                .toString(16)
                .padStart(4, '0')}`}
            />
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <TextField
              size="small"
              label="VID (hex)"
              value={vid}
              onChange={(e) => setVid(e.target.value)}
              placeholder="0x303a"
              sx={{ width: 140 }}
            />
            <TextField
              size="small"
              label="PID (hex, 선택)"
              value={pid}
              onChange={(e) => setPid(e.target.value)}
              placeholder="비우면 전체"
              sx={{ width: 180 }}
            />
            <Button
              variant="outlined"
              startIcon={<UsbIcon />}
              onClick={onRequest}
              disabled={busy}
            >
              장치 선택
            </Button>
            {!isOpen ? (
              <Button
                variant="contained"
                onClick={onOpen}
                disabled={!device || busy}
              >
                열기 / 인터페이스 청구
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="error"
                startIcon={<LinkOffIcon />}
                onClick={() => close()}
                disabled={busy}
              >
                닫기
              </Button>
            )}
          </Stack>

          {endpoints && (
            <Typography variant="caption" color="text.secondary">
              interface={endpoints.interfaceNumber} · alt={endpoints.alternate} · IN=
              {endpoints.inEndpoint ?? '-'} · OUT={endpoints.outEndpoint ?? '-'} · pkt=
              {endpoints.packetSize}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">데이터 보내기</Typography>
            <TextField
              size="small"
              select
              label="인코딩"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as Encoding)}
              sx={{ width: 140 }}
            >
              <MenuItem value="utf8">UTF-8 텍스트</MenuItem>
              <MenuItem value="hex">HEX 바이트</MenuItem>
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={onSend}
              disabled={!isOpen || busy || endpoints?.outEndpoint == null}
            >
              전송
            </Button>
          </Stack>
          <TextField
            multiline
            minRows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              encoding === 'hex' ? '예: DE AD BE EF' : '보낼 텍스트를 입력하세요'
            }
          />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2">USB 로그</Typography>
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
