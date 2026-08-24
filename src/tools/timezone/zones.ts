const FALLBACK_ZONES = [
  'UTC',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export const ZONES: string[] = (() => {
  const supported = Intl.supportedValuesOf?.('timeZone') ?? FALLBACK_ZONES
  const all = new Set<string>(['UTC', LOCAL_ZONE, ...supported])
  return [...all].sort()
})()

export const DEFAULT_ZONES = [...new Set([LOCAL_ZONE, 'UTC', 'America/New_York', 'Europe/London'])]

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let cached = formatters.get(tz)
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, cached)
  }
  return cached
}

/** 그 시점 tz의 벽시계 시각을, 같은 숫자를 가진 UTC 시각의 ms로 돌려줍니다. */
export function wallMs(instant: number, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

export function zoneOffsetMs(instant: number, tz: string): number {
  return wallMs(instant, tz) - Math.floor(instant / 1000) * 1000
}

/**
 * 벽시계 시각을 실제 시점으로 되돌립니다. 오프셋 자체가 시점에 달려 있어,
 * 한 번 추정한 뒤 그 시점의 오프셋으로 다시 맞춥니다(서머타임 경계 대비).
 */
export function zonedToInstant(wall: number, tz: string): number {
  const guess = wall - zoneOffsetMs(wall, tz)
  return wall - zoneOffsetMs(guess, tz)
}

export function offsetLabel(instant: number, tz: string): string {
  const minutes = Math.round(zoneOffsetMs(instant, tz) / 60000)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hh}:${mm}`
}

export function zoneName(instant: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, timeZoneName: 'long' })
    .formatToParts(instant)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz
}

export function cityLabel(tz: string): string {
  return tz.split('/').at(-1)?.replace(/_/g, ' ') ?? tz
}

export function formatDate(instant: number, tz: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz,
    dateStyle: 'full',
  }).format(instant)
}

export function formatTime(instant: number, tz: string, seconds = true): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(instant)
}

/** datetime-local 입력에 넣을 tz 기준 벽시계 문자열 */
export function toInputValue(instant: number, tz: string): string {
  return new Date(wallMs(instant, tz)).toISOString().slice(0, 19)
}

export function fromInputValue(text: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  return Number.isFinite(wall) ? zonedToInstant(wall, tz) : null
}

/** 두 지역의 시차. 기준 지역에서 본 상대 지역의 앞섬(+)/뒤처짐(-)입니다. */
export function diffLabel(instant: number, base: string, target: string): string {
  const minutes = Math.round((zoneOffsetMs(instant, target) - zoneOffsetMs(instant, base)) / 60000)
  if (minutes === 0) return '기준과 같음'
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `${sign}${hours}시간${rest ? ` ${rest}분` : ''}`
}

/** 기준 지역과 날짜가 며칠 어긋나는지 */
export function dayShift(instant: number, base: string, target: string): number {
  const day = (tz: string) => Math.floor(wallMs(instant, tz) / 86400000)
  return day(target) - day(base)
}
