export type Scale = 's' | 'ms' | 'us' | 'ns'

export const SCALES: { value: Scale; label: string }[] = [
  { value: 's', label: '초' },
  { value: 'ms', label: '밀리초' },
  { value: 'us', label: '마이크로초' },
  { value: 'ns', label: '나노초' },
]

const MS_PER: Record<Scale, number> = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 }

/** 자릿수로 단위를 추정합니다. 초로 읽어 5138년을 넘어서면 한 단계 잘게 봅니다. */
export function detectScale(value: number): Scale {
  const abs = Math.abs(value)
  if (abs < 1e11) return 's'
  if (abs < 1e14) return 'ms'
  if (abs < 1e17) return 'us'
  return 'ns'
}

export function toMs(value: number, scale: Scale): number {
  return value * MS_PER[scale]
}

export function fromMs(ms: number, scale: Scale): number {
  return ms / MS_PER[scale]
}

export type Parsed = {
  ms: number
  /** 숫자로 읽었을 때 사용한 단위. 날짜 문자열로 읽었으면 null */
  scale: Scale | null
}

export function parseInput(text: string, scale: Scale | 'auto'): Parsed | null {
  const cleaned = text.trim().replace(/[,\s_]/g, '')
  if (!cleaned) return null

  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned)) {
    const value = Number(cleaned)
    if (!Number.isFinite(value)) return null
    const used = scale === 'auto' ? detectScale(value) : scale
    const ms = toMs(value, used)
    return Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? { ms, scale: used } : null
  }

  const parsed = Date.parse(text.trim())
  return Number.isFinite(parsed) ? { ms: parsed, scale: null } : null
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31556952000],
  ['month', 2629746000],
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
  ['second', 1000],
]

export function relativeLabel(deltaMs: number): string {
  const rtf = new Intl.RelativeTimeFormat('ko-KR', { numeric: 'auto' })
  const abs = Math.abs(deltaMs)
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return rtf.format(Math.trunc(deltaMs / ms), unit)
  }
  return '방금'
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0')

/** 로컬 오프셋을 붙인 ISO 8601 문자열 */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const body = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  return `${body}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

export function formatIn(ms: number, utc: boolean): string {
  return new Intl.DateTimeFormat('ko-KR', {
    ...(utc ? { timeZone: 'UTC' } : {}),
    dateStyle: 'full',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(ms)
}

/** datetime-local 입력값(벽시계)을 실제 시점으로 읽습니다. */
export function fromLocalInput(text: string, utc: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const ms = utc
    ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))
    : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function toLocalInput(ms: number, utc: boolean): string {
  const d = new Date(ms)
  return utc
    ? d.toISOString().slice(0, 19)
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
