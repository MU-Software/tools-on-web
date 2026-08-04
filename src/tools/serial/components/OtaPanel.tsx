import { useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'
import { type BoardClient } from '../lib/boardClient'

// The firmware verifies this against the image it received when the header is
// present (ota.c), so always send it — a truncated upload then fails loudly
// instead of bricking the slot.
async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  if (!crypto?.subtle) return undefined
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function OtaPanel({ client, capable }: { client: BoardClient; capable: boolean }) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!capable) return null

  const pick = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    setDone(false)
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
  }

  const upload = async () => {
    if (!file) return
    if (!window.confirm(`${file.name} 을(를) 보드에 올리고 재부팅합니다. 진행할까요?`)) return
    setBusy(true)
    setErr(null)
    setDone(false)
    try {
      await client.otaUpload(file.bytes, await sha256Hex(file.bytes))
      setDone(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1">OTA 업데이트</Typography>
          {file && (
            <Chip
              size="small"
              variant="outlined"
              label={`${file.name} · ${(file.bytes.byteLength / 1024).toFixed(0)} KB`}
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Button component="label" size="small" variant="outlined" startIcon={<UploadFileIcon />}>
            .bin 선택
            <input
              type="file"
              accept=".bin"
              hidden
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </Button>
          <Button
            size="small"
            variant="contained"
            color="warning"
            startIcon={<SystemUpdateAltIcon />}
            onClick={() => void upload()}
            disabled={!file || busy}
          >
            업로드
          </Button>
        </Stack>
        {err && <Alert severity="error">{err}</Alert>}
        {done && (
          <Alert severity="success">
            업로드 완료. 보드가 새 이미지로 재부팅합니다 — 30초간 무사고면 롤백이 해제됩니다.
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary">
          SHA-256을 함께 보내 보드가 이미지 무결성을 검증합니다.
        </Typography>
      </Stack>
    </Paper>
  )
}
