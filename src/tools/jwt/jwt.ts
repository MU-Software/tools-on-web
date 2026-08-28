import { base64Decode, fail, hexDecode, hexEncode, utf8Decode, utf8Encode } from '../../lib/bytes'

export type Segment = {
  raw: string
  /** JSON으로 읽혔으면 보기 좋게 들여쓴 문자열, 아니면 원문 */
  text: string
  value: Record<string, unknown> | null
  error: string
}

export type Jwt = {
  /** 서명 대상인 앞 두 조각 */
  signingInput: string
  header: Segment
  payload: Segment
  signature: Uint8Array<ArrayBuffer>
  signatureRaw: string
  alg: string
  typ: string
  /** 조각이 다섯이면 암호화된 JWE라 내용을 열 수 없습니다. */
  encrypted: boolean
}

function readSegment(raw: string): Segment {
  try {
    const text = utf8Decode(base64Decode(raw))
    try {
      const value: unknown = JSON.parse(text)
      const isObject = !!value && typeof value === 'object' && !Array.isArray(value)
      return {
        raw,
        text: JSON.stringify(value, null, 2),
        value: isObject ? (value as Record<string, unknown>) : null,
        error: '',
      }
    } catch {
      return { raw, text, value: null, error: 'JSON이 아닙니다' }
    }
  } catch (e) {
    const reason = e instanceof Error && e.message.includes('Base64') ? e.message : 'UTF-8 문자열이 아닙니다'
    return { raw, text: '', value: null, error: reason }
  }
}

export function parseJwt(token: string): Jwt {
  const trimmed = token.trim().replace(/^Bearer\s+/i, '')
  if (!trimmed) fail('토큰을 입력하세요')
  const parts = trimmed.split('.')
  if (parts.length !== 3 && parts.length !== 5) {
    fail(`점으로 나뉜 조각이 ${parts.length}개입니다. JWS는 3개, JWE는 5개여야 합니다`)
  }

  const header = readSegment(parts[0])
  const encrypted = parts.length === 5
  const payload = encrypted
    ? { raw: parts[1], text: '', value: null, error: '암호화된 JWE라 내용을 열 수 없습니다' }
    : readSegment(parts[1])
  const signatureRaw = parts[parts.length - 1]

  let signature = new Uint8Array()
  try {
    signature = base64Decode(signatureRaw)
  } catch {
    // 서명이 깨져 있어도 헤더와 페이로드는 보여 줍니다.
  }

  return {
    signingInput: `${parts[0]}.${parts[1]}`,
    header,
    payload,
    signature,
    signatureRaw,
    alg: typeof header.value?.alg === 'string' ? header.value.alg : '',
    typ: typeof header.value?.typ === 'string' ? header.value.typ : '',
    encrypted,
  }
}

export const CLAIM_LABELS: Record<string, string> = {
  iss: '발급자',
  sub: '주체',
  aud: '대상',
  exp: '만료 시각',
  nbf: '유효 시작',
  iat: '발급 시각',
  jti: '토큰 ID',
  azp: '인가된 당사자',
  scope: '범위',
  nonce: '재사용 방지 값',
  auth_time: '인증 시각',
}

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time'])

export type ClaimRow = {
  key: string
  label: string
  value: string
  /** 시각 클레임을 사람이 읽는 날짜로 옮긴 값 */
  note: string
}

export function claimRows(payload: Record<string, unknown> | null): ClaimRow[] {
  if (!payload) return []
  return Object.entries(payload).map(([key, value]) => ({
    key,
    label: CLAIM_LABELS[key] ?? '',
    value: typeof value === 'string' ? value : JSON.stringify(value),
    note: TIME_CLAIMS.has(key) && typeof value === 'number' ? formatEpoch(value) : '',
  }))
}

function formatEpoch(seconds: number): string {
  const ms = seconds * 1000
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return ''
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(ms)
}

export type Validity = { state: 'valid' | 'expired' | 'early' | 'unknown'; text: string }

/** exp·nbf로 지금 쓸 수 있는 토큰인지 봅니다. */
export function validity(payload: Record<string, unknown> | null, nowMs: number): Validity {
  const exp = typeof payload?.exp === 'number' ? payload.exp * 1000 : null
  const nbf = typeof payload?.nbf === 'number' ? payload.nbf * 1000 : null
  if (exp != null && nowMs >= exp) return { state: 'expired', text: `만료됨 · ${relative(exp - nowMs)}` }
  if (nbf != null && nowMs < nbf) return { state: 'early', text: `아직 유효하지 않음 · ${relative(nbf - nowMs)}` }
  if (exp != null) return { state: 'valid', text: `유효 · ${relative(exp - nowMs)} 만료` }
  return { state: 'unknown', text: '만료 시각이 없습니다' }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31556952000],
  ['month', 2629746000],
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
  ['second', 1000],
]

function relative(deltaMs: number): string {
  const rtf = new Intl.RelativeTimeFormat('ko-KR', { numeric: 'auto' })
  const abs = Math.abs(deltaMs)
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return rtf.format(Math.trunc(deltaMs / ms), unit)
  }
  return '방금'
}

// --- 서명 검증 ---

const CURVES: Record<string, string> = { '256': 'P-256', '384': 'P-384', '512': 'P-521' }

export type Alg = {
  family: 'HS' | 'RS' | 'PS' | 'ES'
  hash: string
  bits: string
  /** HS는 공유 비밀, 나머지는 공개키가 필요합니다. */
  symmetric: boolean
}

export function parseAlg(alg: string): Alg | null {
  const m = /^(HS|PS|RS|ES)(256|384|512)$/.exec(alg)
  if (!m) return null
  const [, family, bits] = m
  return {
    family: family as Alg['family'],
    hash: `SHA-${bits}`,
    bits,
    symmetric: family === 'HS',
  }
}

export type KeyFormat = 'utf8' | 'base64' | 'hex' | 'pem' | 'jwk'

function verifyParams(alg: Alg): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (alg.family === 'HS') return { name: 'HMAC' }
  if (alg.family === 'RS') return { name: 'RSASSA-PKCS1-v1_5' }
  if (alg.family === 'PS') return { name: 'RSA-PSS', saltLength: Number(alg.bits) / 8 }
  return { name: 'ECDSA', hash: alg.hash }
}

function importParams(alg: Alg): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | HmacImportParams {
  if (alg.family === 'HS') return { name: 'HMAC', hash: alg.hash }
  if (alg.family === 'RS') return { name: 'RSASSA-PKCS1-v1_5', hash: alg.hash }
  if (alg.family === 'PS') return { name: 'RSA-PSS', hash: alg.hash }
  return { name: 'ECDSA', namedCurve: CURVES[alg.bits] }
}

function pemToDer(text: string): Uint8Array<ArrayBuffer> {
  const body = text.replace(/-----[^-]*-----/g, '')
  if (/PRIVATE KEY/.test(text)) fail('개인키 대신 공개키를 넣어 주세요')
  return base64Decode(body)
}

async function importKey(alg: Alg, key: string, format: KeyFormat): Promise<CryptoKey> {
  const params = importParams(alg)
  if (alg.symmetric) {
    const raw =
      format === 'base64' ? base64Decode(key) : format === 'hex' ? hexDecode(key) : utf8Encode(key)
    return crypto.subtle.importKey('raw', raw, params, false, ['verify'])
  }
  const trimmed = key.trim()
  if (trimmed.startsWith('{')) {
    return crypto.subtle.importKey('jwk', JSON.parse(trimmed) as JsonWebKey, params, false, ['verify'])
  }
  return crypto.subtle.importKey('spki', pemToDer(trimmed), params, false, ['verify'])
}

export async function verifySignature(jwt: Jwt, key: string, format: KeyFormat): Promise<boolean> {
  const alg = parseAlg(jwt.alg)
  if (!alg) fail(`검증할 수 없는 알고리즘입니다: ${jwt.alg || '(없음)'}`)
  const cryptoKey = await importKey(alg, key, format)
  return crypto.subtle.verify(
    verifyParams(alg),
    cryptoKey,
    jwt.signature,
    utf8Encode(jwt.signingInput),
  )
}

export const signatureHex = (jwt: Jwt) => hexEncode(jwt.signature, ' ')
