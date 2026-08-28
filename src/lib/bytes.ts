const encoder = new TextEncoder()

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function isUtf8(bytes: Uint8Array): boolean {
  try {
    utf8Decode(bytes)
    return true
  } catch {
    return false
  }
}

/** never 반환을 명시해 호출한 곳에서 타입이 좁혀지게 합니다. */
export const fail: (message: string) => never = (message) => {
  throw new Error(message)
}

const CHUNK = 0x8000

function toBinaryString(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

function fromBinaryString(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

export function base64Encode(bytes: Uint8Array): string {
  return btoa(toBinaryString(bytes))
}

/** 표준·URL 안전 알파벳을 모두 받고, 빠진 패딩은 채워 읽습니다. */
export function base64Decode(text: string): Uint8Array<ArrayBuffer> {
  const cleaned = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (/[^A-Za-z0-9+/]/.test(cleaned)) fail('Base64에 쓸 수 없는 문자가 있습니다')
  try {
    return fromBinaryString(atob(cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4)))
  } catch {
    return fail('Base64 길이가 맞지 않습니다')
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const hex2 = (n: number) => n.toString(16).padStart(2, '0')

export function hexEncode(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes, (b) => hex2(b)).join(separator)
}

export function hexDecode(text: string): Uint8Array<ArrayBuffer> {
  const cleaned = text.replace(/0x|\\x/gi, '').replace(/[\s,:;\-_]/g, '')
  if (/[^0-9a-f]/i.test(cleaned)) fail('16진수가 아닌 문자가 있습니다')
  if (cleaned.length % 2) fail('16진수 자릿수가 홀수입니다')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  return out
}
