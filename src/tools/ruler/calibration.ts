import { useEffect, useState } from 'react'

export const MM_PER_INCH = 25.4
/** ISO/IEC 7810 ID-1 (신용카드·주민등록증) 규격 */
export const CARD_MM = { long: 85.6, short: 53.98 }
/** CSS가 1px을 정의할 때 쓰는 명목 해상도 */
export const CSS_DPI = 96

const KEY = 'tools-on-web:ruler-ppi'

export function loadPpi(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null // 사생활 모드 등에서 접근이 막힐 수 있다
  }
}

export function savePpi(ppi: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(ppi * 100) / 100))
  } catch {
    /* 저장 실패는 무시한다 */
  }
}

export function clearPpi(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 삭제 실패는 무시한다 */
  }
}

export type ScreenInfo = {
  cssWidth: number
  cssHeight: number
  deviceWidth: number
  deviceHeight: number
  diagonalPx: number
}

export function readScreen(dpr: number): ScreenInfo {
  const cssWidth = screen.width
  const cssHeight = screen.height
  const deviceWidth = Math.round(cssWidth * dpr)
  const deviceHeight = Math.round(cssHeight * dpr)
  return {
    cssWidth,
    cssHeight,
    deviceWidth,
    deviceHeight,
    diagonalPx: Math.hypot(deviceWidth, deviceHeight),
  }
}

/**
 * 보정값은 물리 픽셀 기준(PPI)으로 다룬다.
 * 브라우저 확대/축소는 devicePixelRatio에 그대로 반영되므로, 확대해도 자의 실제 길이가 유지된다.
 */
export const cssPxPerMm = (ppi: number, dpr: number) => ppi / dpr / MM_PER_INCH
export const ppiFromCssPxPerMm = (perMm: number, dpr: number) => perMm * dpr * MM_PER_INCH
export const defaultPpi = (dpr: number) => CSS_DPI * dpr
export const ppiFromDiagonal = (inch: number, info: ScreenInfo) => info.diagonalPx / inch
export const diagonalInch = (ppi: number, info: ScreenInfo) => info.diagonalPx / ppi

/** 확대/축소나 다른 배율의 모니터로 이동하면 자를 다시 그리도록 배율을 추적합니다. */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)

  useEffect(() => {
    let query: MediaQueryList | null = null
    let done = false

    const watch = () => {
      query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      query.addEventListener('change', onChange)
    }
    const onChange = () => {
      query?.removeEventListener('change', onChange)
      if (done) return
      setDpr(window.devicePixelRatio || 1)
      watch()
    }

    // 윈도우·리눅스의 소수 배율은 미디어 쿼리 문자열이 딱 맞지 않을 수 있어 창 크기도 함께 본다
    const onResize = () => setDpr(window.devicePixelRatio || 1)

    watch()
    window.addEventListener('resize', onResize)
    return () => {
      done = true
      query?.removeEventListener('change', onChange)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return dpr
}
