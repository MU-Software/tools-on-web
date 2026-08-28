import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { copyText } from '../../lib/clipboard'
import {
  CLAIM_LABELS,
  type Jwt,
  type KeyFormat,
  claimRows,
  parseAlg,
  parseJwt,
  signatureHex,
  validity,
  verifySignature,
} from './jwt'

/** 비밀키 tools-on-web 으로 실제 서명한 토큰이라 검증까지 해 볼 수 있습니다. */
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRvb2xzIG9uIFdlYiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.62y4jlZAPOFJgIk11WoqzaImCw74nfZlLooHCIPxOQA'

const SECRET_FORMATS: { value: KeyFormat; label: string }[] = [
  { value: 'utf8', label: '평문' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: '16진수' },
]

const STATE_COLOR = {
  valid: 'success',
  expired: 'error',
  early: 'warning',
  unknown: 'default',
} as const

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 어떤 입력으로 얻은 결과인지 함께 담아, 입력이 바뀌면 저절로 흘려보냅니다. */
type Verified = { token: string; key: string; format: KeyFormat; ok: boolean; error: string }

export default function JwtParser() {
  const [token, setToken] = useState(SAMPLE)
  const [key, setKey] = useState('')
  const [secretFormat, setSecretFormat] = useState<KeyFormat>('utf8')
  const [verified, setVerified] = useState<Verified | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState('')

  const parsed = useMemo(() => {
    try {
      return { jwt: parseJwt(token), error: '' }
    } catch (e) {
      return { jwt: null, error: token.trim() ? message(e) : '' }
    }
  }, [token])

  const jwt = parsed.jwt
  const alg = jwt ? parseAlg(jwt.alg) : null

  // 검증 결과는 그때 쓴 토큰·키에만 해당하므로 입력이 달라지면 감춥니다.
  const result =
    verified && verified.token === token && verified.key === key && verified.format === secretFormat
      ? verified
      : null

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const copy = async (value: string, what: string) => {
    setToast((await copyText(value)) ? `${what} 복사` : '복사하지 못했습니다')
  }

  const verify = async () => {
    if (!jwt) return
    const format: KeyFormat = alg?.symmetric ? secretFormat : key.trim().startsWith('{') ? 'jwk' : 'pem'
    const base = { token, key, format }
    try {
      setVerified({ ...base, ok: await verifySignature(jwt, key, format), error: '' })
    } catch (e) {
      setVerified({ ...base, ok: false, error: message(e) })
    }
  }

  const claims = claimRows(jwt?.payload.value ?? null)
  const state = jwt ? validity(jwt.payload.value, now) : null

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <TextField
              value={token}
              onChange={(e) => setToken(e.target.value)}
              label="JWT"
              placeholder="eyJhbGciOi..."
              size="small"
              multiline
              minRows={3}
              maxRows={10}
              slotProps={{
                htmlInput: {
                  autoComplete: 'off',
                  spellCheck: false,
                  style: { fontFamily: 'ui-monospace, monospace', fontSize: '.85rem', wordBreak: 'break-all' },
                },
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setToken('')} disabled={!token}>
                지우기
              </Button>
              <Button size="small" onClick={() => setToken(SAMPLE)}>
                예시
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {parsed.error && <Alert severity="warning">{parsed.error}</Alert>}

      {jwt && (
        <>
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Chip size="small" label={jwt.alg || 'alg 없음'} />
                {jwt.typ && <Chip size="small" variant="outlined" label={jwt.typ} />}
                {state && (
                  <Chip size="small" color={STATE_COLOR[state.state]} variant="outlined" label={state.text} />
                )}
                {jwt.encrypted && <Chip size="small" color="warning" label="JWE" />}
              </Stack>
            </CardContent>
          </Card>

          <Section title="헤더" segment={jwt.header} onCopy={copy} />
          <Section title="페이로드" segment={jwt.payload} onCopy={copy} />

          {claims.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                  클레임
                </Typography>
                <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
                  {claims.map((claim) => (
                    <Stack
                      key={claim.key}
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ py: 0.75, alignItems: 'baseline' }}
                    >
                      <Box sx={{ flex: 'none', width: { xs: '100%', sm: 170 } }}>
                        <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '.82rem' }}>
                          {claim.key}
                        </Typography>
                        {claim.label && (
                          <Typography variant="caption" color="text.secondary">
                            {claim.label}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '.85rem', wordBreak: 'break-all' }}>{claim.value}</Typography>
                        {claim.note && (
                          <Typography variant="caption" color="text.secondary">
                            {claim.note}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  ))}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                  {Object.keys(CLAIM_LABELS).length}개 표준 클레임에는 뜻을 함께 적었습니다.
                </Typography>
              </CardContent>
            </Card>
          )}

          <Card variant="outlined">
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">서명</Typography>
                <Box
                  sx={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '.8rem',
                    wordBreak: 'break-all',
                    color: 'text.secondary',
                    maxHeight: 92,
                    overflow: 'auto',
                  }}
                >
                  {signatureHex(jwt) || '읽을 수 없는 서명입니다'}
                </Box>

                {alg ? (
                  <>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                      <TextField
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        label={alg.symmetric ? '비밀키' : '공개키 (PEM 또는 JWK)'}
                        size="small"
                        multiline={!alg.symmetric}
                        minRows={alg.symmetric ? undefined : 3}
                        maxRows={alg.symmetric ? undefined : 8}
                        slotProps={{
                          htmlInput: {
                            autoComplete: 'off',
                            spellCheck: false,
                            style: { fontFamily: 'ui-monospace, monospace', fontSize: '.82rem' },
                          },
                        }}
                        sx={{ flex: 1 }}
                      />
                      {alg.symmetric && (
                        <TextField
                          value={secretFormat}
                          onChange={(e) => setSecretFormat(e.target.value as KeyFormat)}
                          label="키 형식"
                          size="small"
                          select
                          sx={{ minWidth: 130 }}
                        >
                          {SECRET_FORMATS.map((f) => (
                            <MenuItem key={f.value} value={f.value}>
                              {f.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    </Stack>

                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <Button size="small" variant="outlined" onClick={() => void verify()} disabled={!key.trim()}>
                        검증
                      </Button>
                      {result &&
                        (result.error ? (
                          <Typography variant="body2" color="error">
                            {result.error}
                          </Typography>
                        ) : (
                          <Chip
                            size="small"
                            color={result.ok ? 'success' : 'error'}
                            label={result.ok ? '서명이 맞습니다' : '서명이 맞지 않습니다'}
                          />
                        ))}
                    </Stack>
                  </>
                ) : (
                  <Alert severity="info">
                    {jwt.alg || '알 수 없는'} 알고리즘은 이 도구에서 검증하지 않습니다. HS·RS·PS·ES 256/384/512만
                    확인합니다.
                  </Alert>
                )}

                <Typography variant="caption" color="text.secondary">
                  토큰과 키는 브라우저 안에서만 다루며 어디로도 보내지 않습니다.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </>
      )}

      <Snackbar open={!!toast} message={toast} autoHideDuration={1800} onClose={() => setToast('')} />
    </Stack>
  )
}

function Section({
  title,
  segment,
  onCopy,
}: {
  title: string
  segment: Jwt['header']
  onCopy: (value: string, what: string) => void
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2">{title}</Typography>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            size="small"
            onClick={() => onCopy(segment.text, title)}
            disabled={!segment.text}
            aria-label={`${title} 복사`}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Stack>
        {segment.error ? (
          <Typography variant="body2" color="text.secondary">
            {segment.error}
          </Typography>
        ) : (
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: 'ui-monospace, monospace',
              fontSize: '.82rem',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 320,
              overflow: 'auto',
            }}
          >
            {segment.text}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
