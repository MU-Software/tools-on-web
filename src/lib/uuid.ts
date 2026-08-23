/** 랜덤 UUID v4 (crypto.randomUUID 미지원 환경 폴백 포함) */
export function uuidv4(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
