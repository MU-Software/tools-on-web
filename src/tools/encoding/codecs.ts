import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  fail,
  hex2,
  hexDecode,
  hexEncode,
  isUtf8,
  utf8Decode,
  utf8Encode,
} from '../../lib/bytes'
import { sniff } from './media'

// --- Base32 (RFC 4648) ---

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out + '='.repeat((8 - (out.length % 8)) % 8)
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const cleaned = text.replace(/[\s=]/g, '').toUpperCase()
  const out: number[] = []
  let value = 0
  let bits = 0
  for (const ch of cleaned) {
    const index = B32.indexOf(ch)
    if (index < 0) fail(`Base32에 없는 문자입니다: ${ch}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

// --- 진법 ---

export function binaryEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(2).padStart(8, '0')).join(' ')
}

export function binaryDecode(text: string): Uint8Array<ArrayBuffer> {
  const cleaned = text.replace(/[\s_,]/g, '')
  if (/[^01]/.test(cleaned)) fail('0과 1만 쓸 수 있습니다')
  if (cleaned.length % 8) fail('8자리씩 끊어지지 않습니다')
  const out = new Uint8Array(cleaned.length / 8)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 8, i * 8 + 8), 2)
  return out
}

export function decimalEncode(bytes: Uint8Array): string {
  return Array.from(bytes).join(' ')
}

export function decimalDecode(text: string): Uint8Array<ArrayBuffer> {
  const tokens = text.trim().split(/[^0-9]+/).filter(Boolean)
  return Uint8Array.from(tokens, (t) => {
    const n = Number(t)
    return n <= 255 ? n : fail(`바이트 범위를 넘습니다: ${t}`)
  })
}

// --- 퍼센트 인코딩 ---

const UNRESERVED = /[A-Za-z0-9\-._~]/

export function urlEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => {
    const ch = String.fromCharCode(b)
    return UNRESERVED.test(ch) ? ch : `%${hex2(b).toUpperCase()}`
  }).join('')
}

export function urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const out: number[] = []
  for (let i = 0; i < text.length; ) {
    if (text[i] === '%') {
      const pair = text.slice(i + 1, i + 3)
      if (!/^[0-9a-f]{2}$/i.test(pair)) fail(`% 뒤에 16진수 두 자리가 없습니다: %${pair}`)
      out.push(parseInt(pair, 16))
      i += 3
    } else {
      out.push(...utf8Encode(text[i]))
      i += 1
    }
  }
  return Uint8Array.from(out)
}

// --- 이스케이프 ---

const SHORT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

/** Python str 리터럴처럼 \xNN·\uXXXX·\UXXXXXXXX로 적습니다. */
export function pythonEscape(text: string): string {
  let out = ''
  for (const ch of text) {
    const short = SHORT_ESCAPES[ch]
    if (short) {
      out += short
      continue
    }
    const cp = ch.codePointAt(0) as number
    if (cp >= 0x20 && cp < 0x7f) out += ch
    else if (cp < 0x100) out += `\\x${hex2(cp)}`
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`
    else out += `\\U${cp.toString(16).padStart(8, '0')}`
  }
  return out
}

/** 비ASCII를 UTF-16 코드 단위 단위로 적는 Java·JS·JSON 계열 표기 */
export function unicodeEscape(text: string): string {
  let out = ''
  for (const ch of text) {
    const short = SHORT_ESCAPES[ch]
    if (short) {
      out += short
      continue
    }
    const cp = ch.codePointAt(0) as number
    if (cp >= 0x20 && cp < 0x7f) out += ch
    else for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`
  }
  return out
}

const ONE_CHAR: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  a: '\x07',
  '0': '\0',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '/': '/',
  '\n': '',
}

const takeHex = (text: string, start: number, length: number): number => {
  const digits = text.slice(start, start + length)
  if (digits.length !== length || /[^0-9a-f]/i.test(digits)) fail(`16진수가 모자랍니다: \\${text[start - 1]}${digits}`)
  return parseInt(digits, 16)
}

/** \xNN·\uXXXX·\u{XXXX}·\UXXXXXXXX와 짧은 이스케이프를 되돌립니다. */
export function unescapeText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '\\') {
      out += text[i]
      i += 1
      continue
    }
    const kind = text[i + 1]
    if (kind === 'x') {
      out += String.fromCharCode(takeHex(text, i + 2, 2))
      i += 4
    } else if (kind === 'u' && text[i + 2] === '{') {
      const end = text.indexOf('}', i + 3)
      if (end < 0) fail('\\u{ 를 닫는 } 가 없습니다')
      out += String.fromCodePoint(takeHex(text, i + 3, end - i - 3))
      i = end + 1
    } else if (kind === 'u') {
      out += String.fromCharCode(takeHex(text, i + 2, 4))
      i += 6
    } else if (kind === 'U') {
      out += String.fromCodePoint(takeHex(text, i + 2, 8))
      i += 10
    } else if (kind in ONE_CHAR) {
      out += ONE_CHAR[kind]
      i += 2
    } else {
      fail(`모르는 이스케이프입니다: \\${kind ?? ''}`)
    }
  }
  return out
}

/** b'\xNN' 형태의 Python bytes 리터럴. UTF-8로 다시 읽지 않고 바이트를 그대로 씁니다. */
export function pythonBytesEncode(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte)
    if (byte === 0x5c) out += '\\\\'
    else if (byte === 0x27) out += "\\'"
    else if (byte >= 0x20 && byte < 0x7f) out += ch
    else if (byte === 0x0a) out += '\\n'
    else if (byte === 0x0d) out += '\\r'
    else if (byte === 0x09) out += '\\t'
    else out += `\\x${hex2(byte)}`
  }
  return `b'${out}'`
}

export function pythonBytesDecode(text: string): Uint8Array<ArrayBuffer> {
  const trimmed = text.trim()
  const quoted = /^(?:b|rb|br)?(['"])([\s\S]*)\1$/i.exec(trimmed)
  const body = quoted ? quoted[2] : trimmed
  const out: number[] = []
  for (let i = 0; i < body.length; ) {
    if (body[i] !== '\\') {
      out.push(...utf8Encode(body[i]))
      i += 1
      continue
    }
    const kind = body[i + 1]
    if (kind === 'x') {
      out.push(takeHex(body, i + 2, 2))
      i += 4
    } else if (kind in ONE_CHAR) {
      out.push(...utf8Encode(ONE_CHAR[kind]))
      i += 2
    } else {
      fail(`bytes 리터럴에 쓸 수 없는 이스케이프입니다: \\${kind ?? ''}`)
    }
  }
  return Uint8Array.from(out)
}

// --- JSON·HTML·코드포인트 ---

export function jsonDecode(text: string): string {
  const trimmed = text.trim()
  const quoted = /^".*"$/s.test(trimmed) ? trimmed : JSON.stringify(trimmed).replace(/\\\\/g, '\\')
  try {
    const value: unknown = JSON.parse(quoted)
    return typeof value === 'string' ? value : fail('JSON 문자열이 아닙니다')
  } catch {
    return fail('JSON 문자열로 읽을 수 없습니다')
  }
}

const HTML_NAMED: Record<string, string> = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function htmlEncode(text: string): string {
  let out = ''
  for (const ch of text) {
    const named = HTML_NAMED[ch]
    const cp = ch.codePointAt(0) as number
    if (named) out += `&${named};`
    else if (cp < 0x80) out += ch
    else out += `&#x${cp.toString(16).toUpperCase()};`
  }
  return out
}

export function htmlDecode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function codePointsEncode(text: string): string {
  return Array.from(text, (ch) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')
}

export function codePointsDecode(text: string): string {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const m = /^(?:U\+|0x|\\u)?([0-9a-f]{1,6})$/i.exec(token)
      if (!m) fail(`코드포인트로 읽을 수 없습니다: ${token}`)
      const cp = parseInt((m as RegExpExecArray)[1], 16)
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : fail(`코드포인트 범위를 넘습니다: ${token}`)
    })
    .join('')
}

// --- Data URL ---

export function dataUrlEncode(bytes: Uint8Array): string {
  return `data:${sniff(bytes, isUtf8(bytes)).mime};base64,${base64Encode(bytes)}`
}

export function dataUrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const m = /^data:[^,]*?(;base64)?,([\s\S]*)$/i.exec(text.trim())
  if (!m) fail('data: URL 형태가 아닙니다')
  const [, isBase64, body] = m as RegExpExecArray
  return isBase64 ? base64Decode(body) : urlDecode(body)
}

// --- 코덱 목록 ---

export type Codec = {
  id: string
  label: string
  hint: string
  /** 텍스트 계열은 UTF-8로 읽히는 바이트만 다룹니다. */
  group: 'bytes' | 'text'
  /** 이보다 큰 입력은 문자열을 만들지 않고 건너뜁니다. */
  maxBytes: number
  encode: (bytes: Uint8Array) => string
  decode: (text: string) => Uint8Array<ArrayBuffer>
}

const MB = 1 << 20
const KB64 = 1 << 16

const textCodec = (
  id: string,
  label: string,
  hint: string,
  encode: (text: string) => string,
  decode: (text: string) => string,
  maxBytes = MB,
): Codec => ({
  id,
  label,
  hint,
  group: 'text',
  maxBytes,
  encode: (bytes) => encode(utf8Decode(bytes)),
  decode: (text) => utf8Encode(decode(text)),
})

export const CODECS: Codec[] = [
  textCodec('text', '평문 (UTF-8)', '사람이 읽는 문자열', (t) => t, (t) => t),
  {
    id: 'base64',
    label: 'Base64',
    hint: 'RFC 4648 표준 알파벳',
    group: 'bytes',
    maxBytes: MB,
    encode: base64Encode,
    decode: base64Decode,
  },
  {
    id: 'base64url',
    label: 'Base64URL',
    hint: '+/ 대신 -_ 를 쓰고 = 를 뗀 형태',
    group: 'bytes',
    maxBytes: MB,
    encode: base64UrlEncode,
    decode: base64Decode,
  },
  {
    id: 'base32',
    label: 'Base32',
    hint: 'RFC 4648, TOTP 키에 쓰이는 형태',
    group: 'bytes',
    maxBytes: MB,
    encode: base32Encode,
    decode: base32Decode,
  },
  {
    id: 'hex',
    label: '16진수',
    hint: '붙여 쓴 소문자 hex',
    group: 'bytes',
    maxBytes: MB,
    encode: (bytes) => hexEncode(bytes),
    decode: hexDecode,
  },
  {
    id: 'hexSpaced',
    label: '16진수 (공백 구분)',
    hint: '바이트마다 띄어 쓴 hex 덤프',
    group: 'bytes',
    maxBytes: KB64,
    encode: (bytes) => hexEncode(bytes, ' '),
    decode: hexDecode,
  },
  {
    id: 'binary',
    label: '2진수',
    hint: '바이트마다 8자리',
    group: 'bytes',
    maxBytes: KB64,
    encode: binaryEncode,
    decode: binaryDecode,
  },
  {
    id: 'decimal',
    label: '10진 바이트',
    hint: '0~255 값의 나열',
    group: 'bytes',
    maxBytes: KB64,
    encode: decimalEncode,
    decode: decimalDecode,
  },
  {
    id: 'url',
    label: 'URL 퍼센트 인코딩',
    hint: '예약되지 않은 문자만 남기고 %XX',
    group: 'bytes',
    maxBytes: MB,
    encode: urlEncode,
    decode: urlDecode,
  },
  {
    id: 'pybytes',
    label: "Python bytes (b'\\xNN')",
    hint: '바이트를 그대로 담는 리터럴',
    group: 'bytes',
    maxBytes: KB64,
    encode: pythonBytesEncode,
    decode: pythonBytesDecode,
  },
  {
    id: 'dataurl',
    label: 'Data URL',
    hint: '매직 넘버로 찾은 MIME + Base64',
    group: 'bytes',
    maxBytes: MB,
    encode: dataUrlEncode,
    decode: dataUrlDecode,
  },
  textCodec('python', 'Python 문자열 이스케이프', '\\xNN · \\uXXXX · \\UXXXXXXXX', pythonEscape, unescapeText, KB64),
  textCodec('unicode', '유니코드 이스케이프 (\\uXXXX)', 'Java·JS·JSON 계열 표기', unicodeEscape, unescapeText, KB64),
  textCodec('json', 'JSON 문자열', '따옴표까지 포함한 리터럴', (t) => JSON.stringify(t), jsonDecode, KB64),
  textCodec('html', 'HTML 엔티티', '&amp; · &#xNNNN;', htmlEncode, htmlDecode, KB64),
  textCodec('codepoints', '유니코드 코드포인트', 'U+D55C 형태의 나열', codePointsEncode, codePointsDecode, KB64),
]

export const CODEC_BY_ID: Record<string, Codec> = Object.fromEntries(CODECS.map((c) => [c.id, c]))

/**
 * 패딩이 붙었으면 전체 길이가 4의 배수인지만 봅니다. 패딩이 없으면 평문과 헷갈리므로
 * 길이에 더해 숫자나 +/ 같은 흔적을 함께 요구합니다.
 */
function looksBase64(compact: string): boolean {
  const body = compact.replace(/=+$/, '')
  if (body.length !== compact.length) return compact.length % 4 === 0
  return body.length % 4 !== 1 && /[0-9+/]/.test(body)
}

/** 입력 모양으로 형식을 추정합니다. 확신이 서지 않으면 평문으로 둡니다. */
export function detectCodec(text: string): Codec {
  const trimmed = text.trim()
  const compact = trimmed.replace(/\s/g, '')
  const pick = (id: string) => CODEC_BY_ID[id]

  if (/^data:[^,]*,/i.test(trimmed)) return pick('dataurl')
  if (/^(?:b|rb|br)['"]/i.test(trimmed)) return pick('pybytes')
  if (/^(?:U\+[0-9a-f]{4,6}[\s,]*)+$/i.test(trimmed)) return pick('codepoints')
  if (/\\u\{?[0-9a-f]{4}|\\U[0-9a-f]{8}/i.test(trimmed)) return pick('python')
  if (/\\x[0-9a-f]{2}/i.test(trimmed)) return pick('pybytes')
  if (/&(?:#x?[0-9a-f]+|[a-z]+);/i.test(trimmed)) return pick('html')
  if (/^".*"$/s.test(trimmed)) return pick('json')
  if (/%[0-9a-f]{2}/i.test(trimmed)) return pick('url')
  if (/^[01\s]+$/.test(trimmed) && compact.length >= 8 && compact.length % 8 === 0) return pick('binary')
  if (/^\d{1,3}(?:[\s,]+\d{1,3})+$/.test(trimmed) && trimmed.split(/[\s,]+/).every((n) => Number(n) <= 255)) {
    return pick('decimal')
  }
  if (/^(?:0x)?[0-9a-f]+$/i.test(compact) && compact.length >= 4 && compact.replace(/^0x/i, '').length % 2 === 0) {
    return pick('hex')
  }
  if (/^[A-Z2-7]+=*$/.test(compact) && compact.length >= 8 && compact.length % 8 === 0) return pick('base32')
  if (/^[A-Za-z0-9+/]+=*$/.test(compact) && compact.length >= 8 && looksBase64(compact)) return pick('base64')
  if (/^[A-Za-z0-9\-_]+=*$/.test(compact) && /[-_]/.test(compact) && compact.length >= 8 && looksBase64(compact)) {
    return pick('base64url')
  }
  return pick('text')
}
