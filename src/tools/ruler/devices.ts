import type { ScreenInfo } from './calibration'
import {
  APPLE_DEVICES,
  CURATED,
  DEVICE_DB_DATE,
  MODEL_INDEX,
  OTHER_DEVICES,
  type DeviceRow,
} from './devices.generated'

export { DEVICE_DB_DATE }

export type Platform = 'ios' | 'ipad' | 'mac' | 'android' | 'windows' | 'linux' | 'other'

export type Preset = { id: string; group: string; label: string; ppi: number }

export type Detection = {
  ppi: number
  label: string
  presetId: string
  /** high: 모델·해상도까지 일치, medium: 계열만 일치, low: 형태만 보고 넘겨짚음 */
  confidence: 'high' | 'medium' | 'low'
}

const GROUP = {
  iphone: 'iPhone · iPod',
  ipad: 'iPad',
  mac: 'Mac (기본 배율)',
  android: '안드로이드 (최신)',
  phone: '스마트폰',
  tablet: '태블릿',
  laptop: '노트북',
  desktop: '데스크톱 · 모니터',
  size: '일반 크기',
  shape: '형태만 고르기',
} as const

const KIND_GROUP: Record<DeviceRow['kind'], string> = {
  phone: GROUP.phone,
  tablet: GROUP.tablet,
  laptop: GROUP.laptop,
  desktop: GROUP.desktop,
}

/** 형태별 CSS 기준 해상도(dpi). 표에 없는 장치는 여기에 배율을 곱해 넘겨짚는다. */
const CSS_DPI_BY_SHAPE = { phone: 152, tablet: 132, desktop: 96 } as const

/**
 * 최신 맥은 공개 DB가 못 따라오고, macOS는 논리 해상도를 자유롭게 바꿀 수 있다.
 * 그래서 패널의 실제 픽셀 수를 들고 있다가 지금 논리 해상도에 맞춰 환산한다.
 */
type MacPanel = {
  name: string
  /** 패널 실제 픽셀 (짧은 변, 긴 변) */
  panel: [number, number]
  /** 패널 자체의 PPI */
  ppi: number
  /** macOS 기본값으로 잡히는 논리 해상도 (짧은 변, 긴 변) */
  css: [number, number]
}

const MAC_PANELS: MacPanel[] = [
  { name: 'MacBook Pro 14형', panel: [1964, 3024], ppi: 254, css: [982, 1512] },
  { name: 'MacBook Pro 16형', panel: [2234, 3456], ppi: 254, css: [1117, 1728] },
  { name: 'MacBook Pro 16형 (2019)', panel: [1920, 3072], ppi: 226, css: [1120, 1792] },
  { name: 'MacBook Air 13형 (M2~)', panel: [1664, 2560], ppi: 224, css: [956, 1470] },
  { name: 'MacBook Air 15형', panel: [1864, 2880], ppi: 224, css: [1112, 1710] },
  { name: 'MacBook Air·Pro 13형 Retina', panel: [1600, 2560], ppi: 227, css: [900, 1440] },
  { name: 'MacBook Pro 15형 Retina', panel: [1800, 2880], ppi: 220, css: [900, 1440] },
  { name: 'MacBook 12형 Retina', panel: [1440, 2304], ppi: 226, css: [800, 1280] },
  { name: 'iMac 24형', panel: [2520, 4480], ppi: 218, css: [1260, 2240] },
  { name: 'iMac 21.5형 4K', panel: [2304, 4096], ppi: 219, css: [1152, 2048] },
  { name: 'Studio Display · iMac 27형 5K', panel: [2880, 5120], ppi: 218, css: [1440, 2560] },
  { name: 'Pro Display XDR', panel: [3384, 6016], ppi: 218, css: [1692, 3008] },
]

/**
 * 배율을 바꾸면 CSS 픽셀이 실제 픽셀과 1:1이 아니게 되므로,
 * 자에 필요한 밀도는 지금 프레임버퍼(논리 해상도 × 배율)에 비례해 환산한다.
 */
const macPpi = (mac: MacPanel, longCss: number, dpr: number) =>
  Math.round((mac.ppi * longCss * dpr) / mac.panel[1])

/** 제품을 특정할 수 없을 때 고르는 '흔한 크기' 목록 */
const FALLBACKS: Preset[] = [
  { id: 's-mon-215fhd', group: GROUP.size, label: '21.5형 FHD (1920×1080)', ppi: 102 },
  { id: 's-mon-24fhd', group: GROUP.size, label: '24형 FHD (1920×1080)', ppi: 92 },
  { id: 's-mon-27fhd', group: GROUP.size, label: '27형 FHD (1920×1080)', ppi: 82 },
  { id: 's-mon-24qhd', group: GROUP.size, label: '24형 QHD (2560×1440)', ppi: 122 },
  { id: 's-mon-27qhd', group: GROUP.size, label: '27형 QHD (2560×1440)', ppi: 109 },
  { id: 's-mon-32qhd', group: GROUP.size, label: '32형 QHD (2560×1440)', ppi: 93 },
  { id: 's-mon-27uhd', group: GROUP.size, label: '27형 4K (3840×2160)', ppi: 163 },
  { id: 's-mon-32uhd', group: GROUP.size, label: '32형 4K (3840×2160)', ppi: 138 },
  { id: 's-mon-34uw', group: GROUP.size, label: '34형 울트라와이드 (3440×1440)', ppi: 110 },
  { id: 's-mon-49dqhd', group: GROUP.size, label: '49형 듀얼 QHD (5120×1440)', ppi: 109 },
  { id: 's-nb-133fhd', group: GROUP.size, label: '13.3형 FHD 노트북', ppi: 166 },
  { id: 's-nb-14fhd', group: GROUP.size, label: '14형 FHD 노트북', ppi: 157 },
  { id: 's-nb-156fhd', group: GROUP.size, label: '15.6형 FHD 노트북', ppi: 141 },
  { id: 's-nb-16qhd', group: GROUP.size, label: '16형 QHD+ 노트북 (2560×1600)', ppi: 189 },
  { id: 's-nb-14qhd', group: GROUP.size, label: '14형 2.8K 노트북 (2880×1800)', ppi: 243 },
  { id: 's-nb-156uhd', group: GROUP.size, label: '15.6형 4K 노트북', ppi: 282 },
  { id: 's-tv-43', group: GROUP.size, label: '43형 4K TV·모니터', ppi: 103 },
  { id: 's-tv-55', group: GROUP.size, label: '55형 4K TV', ppi: 80 },
  { id: 's-tv-65', group: GROUP.size, label: '65형 4K TV', ppi: 68 },
  { id: 'shape-phone', group: GROUP.shape, label: '스마트폰 (배율로 추정)', ppi: 0 },
  { id: 'shape-tablet', group: GROUP.shape, label: '태블릿 (배율로 추정)', ppi: 0 },
  { id: 'shape-desktop', group: GROUP.shape, label: '데스크톱 (표준 96dpi)', ppi: 0 },
]

/** 배율까지 곱한 실제 픽셀 수가 흔한 해상도와 같으면 그 크기의 화면으로 본다. */
const BY_RESOLUTION: { res: [number, number]; preset: string }[] = [
  { res: [768, 1366], preset: 's-nb-156fhd' },
  { res: [800, 1280], preset: 's-nb-133fhd' },
  { res: [1080, 1920], preset: 's-mon-24fhd' },
  { res: [1200, 1920], preset: 's-mon-24fhd' },
  { res: [1440, 2560], preset: 's-mon-27qhd' },
  { res: [1600, 2560], preset: 's-nb-16qhd' },
  { res: [1800, 2880], preset: 's-nb-14qhd' },
  { res: [2160, 3840], preset: 's-mon-27uhd' },
  { res: [1440, 3440], preset: 's-mon-34uw' },
  { res: [1440, 5120], preset: 's-mon-49dqhd' },
]

const GROUP_ORDER: string[] = [
  GROUP.iphone,
  GROUP.ipad,
  GROUP.mac,
  GROUP.android,
  GROUP.phone,
  GROUP.tablet,
  GROUP.laptop,
  GROUP.desktop,
  GROUP.size,
  GROUP.shape,
]

// 목록에서 그룹이 흩어지지 않도록 정렬해 둔다
export const PRESETS: Preset[] = [
  ...APPLE_DEVICES.map((d, i) => ({
    id: `a${i}`,
    group: d.platform === 'ipad' ? GROUP.ipad : GROUP.iphone,
    label: d.name,
    ppi: d.ppi,
  })),
  ...MAC_PANELS.map((d, i) => ({ id: `m${i}`, group: GROUP.mac, label: d.name, ppi: d.ppi })),
  ...CURATED.map(([label, ppi], i) => ({ id: `c${i}`, group: GROUP.android, label, ppi })),
  ...OTHER_DEVICES.map((d, i) => ({ id: `o${i}`, group: KIND_GROUP[d.kind], label: d.name, ppi: d.ppi })),
  ...FALLBACKS,
].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))

export const PRESET_GROUPS = GROUP_ORDER

const byId = (id: string) => PRESETS.find((p) => p.id === id)

/** 맥과 '형태만 고르기' 항목은 지금 화면 상태에 맞춰 값을 계산합니다. */
export function presetPpi(preset: Preset, dpr: number, info: ScreenInfo): number {
  const mac = preset.id.startsWith('m') && MAC_PANELS[Number(preset.id.slice(1))]
  if (mac) return macPpi(mac, Math.max(info.cssWidth, info.cssHeight), dpr)
  if (preset.ppi > 0) return preset.ppi
  const form = preset.id.replace('shape-', '') as keyof typeof CSS_DPI_BY_SHAPE
  return (CSS_DPI_BY_SHAPE[form] ?? CSS_DPI_BY_SHAPE.desktop) * dpr
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPod/.test(ua)) return 'ios'
  // iPadOS는 데스크톱 UA를 보내므로 터치 지원으로 가려낸다
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Android/.test(ua)) return 'android'
  if (/Windows/.test(ua)) return 'windows'
  if (/X11|Linux|CrOS/.test(ua)) return 'linux'
  return 'other'
}

type UserAgentData = {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>
}

/** 크로미움 계열은 UA Client Hints로 모델명을 알려줍니다. 안드로이드 기기 식별의 유일한 단서입니다. */
export async function readModel(): Promise<string> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  if (!data?.getHighEntropyValues) return ''
  try {
    const values = await data.getHighEntropyValues(['model'])
    return values.model?.trim() ?? ''
  } catch {
    return ''
  }
}

function curatedByModel(model: string): number | undefined {
  const exact = MODEL_INDEX[model]
  if (exact !== undefined) return exact
  // SM-S928B/SM-S9280처럼 지역별 접미사만 다른 코드까지 잡아 준다
  const stem = model.slice(0, 7)
  if (stem.length < 7) return undefined
  const near = Object.keys(MODEL_INDEX).find((key) => key.startsWith(stem))
  return near === undefined ? undefined : MODEL_INDEX[near]
}

function matchByScreen(rows: DeviceRow[], short: number, long: number, dpr: number) {
  return rows.filter(
    (d) => d.css && d.css[0] === short && d.css[1] === long && Math.abs((d.dpr ?? dpr) - dpr) < 0.01,
  )
}

/** 모니터·노트북은 같은 해상도를 쓰는 제품이 너무 많아 화면 크기로 특정할 수 없다. */
const MOBILE_DEVICES = OTHER_DEVICES.filter((d) => d.kind === 'phone' || d.kind === 'tablet')

/**
 * 배율을 바꾼 맥을 화면비로 찾는다. 14형과 16형처럼 크기만 다른 모델도
 * 패널 화면비는 0.5%가량 달라서, 화면비가 가장 가까운 쪽이 실제 모델이다.
 * 범위 조건은 macOS가 실제로 제공하는 해상도 폭(패널의 0.55~1.3배)이다.
 */
function matchScaledMac(short: number, long: number, dpr: number): MacPanel | undefined {
  const ratio = (mac: MacPanel) => (long * dpr) / mac.panel[1]
  const gap = (mac: MacPanel) => Math.abs(mac.panel[1] / mac.panel[0] / (long / short) - 1)
  return MAC_PANELS.filter((mac) => gap(mac) < 0.01 && ratio(mac) >= 0.55 && ratio(mac) <= 1.3).sort(
    (a, b) => gap(a) - gap(b),
  )[0]
}

function matchResolution(info: ScreenInfo): Preset | undefined {
  const found = BY_RESOLUTION.find(
    (m) =>
      m.res[0] === Math.min(info.deviceWidth, info.deviceHeight) &&
      m.res[1] === Math.max(info.deviceWidth, info.deviceHeight),
  )
  return found ? byId(found.preset) : undefined
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]

function shape(info: ScreenInfo): keyof typeof CSS_DPI_BY_SHAPE {
  if (!matchMedia('(pointer: coarse)').matches) return 'desktop'
  return Math.min(info.cssWidth, info.cssHeight) < 600 ? 'phone' : 'tablet'
}

export function detectDisplay(info: ScreenInfo, dpr: number, model = ''): Detection {
  const platform = detectPlatform()
  const short = Math.min(info.cssWidth, info.cssHeight)
  const long = Math.max(info.cssWidth, info.cssHeight)

  const curated = model ? curatedByModel(model) : undefined
  if (curated !== undefined) {
    const [name, ppi] = CURATED[curated]
    return { ppi, label: `${name} (${model})`, presetId: `c${curated}`, confidence: 'high' }
  }

  if (platform === 'ios' || platform === 'ipad') {
    const [apple] = matchByScreen(APPLE_DEVICES, short, long, dpr)
    if (apple) {
      return {
        ppi: apple.ppi,
        label: apple.name,
        presetId: `a${APPLE_DEVICES.indexOf(apple)}`,
        confidence: 'high',
      }
    }
    return platform === 'ipad'
      ? { ppi: 264, label: 'iPad (일반)', presetId: '', confidence: 'medium' }
      : {
          ppi: dpr >= 2.5 ? 460 : 326,
          label: dpr >= 2.5 ? 'iPhone (Super Retina급)' : 'iPhone (Retina급)',
          presetId: '',
          confidence: 'medium',
        }
  }

  if (platform === 'mac' && dpr >= 1.5) {
    const exact = MAC_PANELS.find((m) => m.css[0] === short && m.css[1] === long)
    if (exact) {
      return {
        ppi: macPpi(exact, long, dpr),
        label: exact.name,
        presetId: `m${MAC_PANELS.indexOf(exact)}`,
        confidence: 'high',
      }
    }
    // 외장 모니터를 정수 배율로 쓰는 경우가 먼저다
    const external = matchResolution(info)
    if (external) {
      return { ppi: external.ppi, label: external.label, presetId: external.id, confidence: 'low' }
    }
    const scaled = matchScaledMac(short, long, dpr)
    if (scaled) {
      return {
        ppi: macPpi(scaled, long, dpr),
        label: `${scaled.name} (배율 변경됨)`,
        presetId: `m${MAC_PANELS.indexOf(scaled)}`,
        confidence: 'medium',
      }
    }
  }

  const mobile = matchByScreen(MOBILE_DEVICES, short, long, dpr)
  if (mobile.length === 1) {
    return {
      ppi: mobile[0].ppi,
      label: mobile[0].name,
      presetId: `o${OTHER_DEVICES.indexOf(mobile[0])}`,
      confidence: 'medium',
    }
  }
  if (mobile.length > 1) {
    // 같은 논리 해상도를 쓰는 기기가 여럿이라 제품은 못 고르고 중앙값만 쓴다
    return {
      ppi: median(mobile.map((d) => d.ppi)),
      label: `${short}×${long} 화면 (${mobile.length}대 중앙값)`,
      presetId: '',
      confidence: 'low',
    }
  }

  if (platform === 'android') {
    // 안드로이드의 배율은 제조사가 신고한 밀도(dpi/160)라, 실제 값과 대체로 10% 안쪽이다
    return {
      ppi: Math.round(dpr * 160),
      label: model ? `${model} (밀도로 추정)` : '안드로이드 기기 (밀도로 추정)',
      presetId: '',
      confidence: 'medium',
    }
  }

  // 배율을 올린 화면은 해상도만으로 크기를 알 수 없다. 15.6형 FHD 노트북을 125%로 쓰면
  // 실제 픽셀이 24형 모니터와 똑같이 1920×1080이라, 해상도 표를 그대로 믿으면 35%가 틀어진다.
  if (dpr < 1.05) {
    const sized = matchResolution(info)
    if (sized) return { ppi: sized.ppi, label: sized.label, presetId: sized.id, confidence: 'low' }
  } else {
    // 윈도우·GNOME은 패널 밀도를 보고 배율을 정하므로, 배율 자체가 밀도의 단서다
    return {
      ppi: Math.round(108 * dpr),
      label: `고해상도 화면 (배율 ${dpr}배 기준 추정)`,
      presetId: '',
      confidence: 'low',
    }
  }

  const form = shape(info)
  const preset = byId(`shape-${form}`)
  return {
    ppi: CSS_DPI_BY_SHAPE[form] * dpr,
    label: preset?.label ?? '알 수 없는 화면',
    presetId: preset?.id ?? '',
    confidence: 'low',
  }
}
