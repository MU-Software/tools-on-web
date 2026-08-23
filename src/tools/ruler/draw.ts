import { MM_PER_INCH } from './calibration'

export type Axis = 'h' | 'v' | 'd'

/** 자의 좌표계. 화면 좌표 = origin + along×u + across×v */
export type Placement = {
  ox: number
  oy: number
  ux: number
  uy: number
  vx: number
  vy: number
  length: number
}

export type RulerTheme = {
  face: string
  ink: string
  sub: string
  accent: string
  onAccent: string
}

export type RulerSpec = {
  axis: Axis
  placement: Placement
  pxPerMm: number
  boxWidth: number
  boxHeight: number
  thickness: number
  dpr: number
  marker: number | null
  theme: RulerTheme
}

const FONT = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'

/** 상자 안에 두께 thickness의 띠를 축 방향대로 최대 길이로 놓습니다. */
export function placeRuler(axis: Axis, boxWidth: number, boxHeight: number, thickness: number): Placement {
  if (axis === 'h') return { ox: 0, oy: 0, ux: 1, uy: 0, vx: 0, vy: 1, length: boxWidth }
  if (axis === 'v') return { ox: 0, oy: 0, ux: 0, uy: 1, vx: 1, vy: 0, length: boxHeight }

  const theta = Math.atan2(boxHeight, boxWidth)
  const sin = Math.sin(theta)
  const cos = Math.cos(theta)
  const length = Math.max(
    0,
    Math.min((boxWidth - thickness * sin) / cos, (boxHeight - thickness * cos) / sin),
  )
  // 기울어진 띠의 외접 사각형을 상자 가운데에 맞춘다
  const spanX = length * cos + thickness * sin
  const spanY = length * sin + thickness * cos
  return {
    ox: (boxWidth - spanX) / 2 + thickness * sin,
    oy: (boxHeight - spanY) / 2,
    ux: cos,
    uy: sin,
    vx: -sin,
    vy: cos,
    length,
  }
}

/** 화면 좌표를 자의 진행 방향 거리로 되돌립니다. */
export function projectToRuler(p: Placement, x: number, y: number): number {
  return Math.min(Math.max((x - p.ox) * p.ux + (y - p.oy) * p.uy, 0), p.length)
}

export function drawRuler(canvas: HTMLCanvasElement, spec: RulerSpec): void {
  const { axis, placement: p, pxPerMm, boxWidth, boxHeight, thickness, dpr, marker, theme } = spec

  canvas.width = Math.max(1, Math.round(boxWidth * dpr))
  canvas.height = Math.max(1, Math.round(boxHeight * dpr))
  canvas.style.width = `${boxWidth}px`
  canvas.style.height = `${boxHeight}px`

  const ctx = canvas.getContext('2d')
  if (!ctx || pxPerMm <= 0 || p.length <= 0) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, boxWidth, boxHeight)
  ctx.font = FONT

  const aligned = axis !== 'd'
  /** 눈금선이 물리 픽셀 격자에 걸리도록 맞춥니다. 기울어진 자는 어차피 격자에 못 맞춘다. */
  const snap = (v: number) => (aligned ? Math.round(v * dpr) / dpr + 0.5 / dpr : v)
  const at = (along: number, across: number): [number, number] => [
    p.ox + along * p.ux + across * p.vx,
    p.oy + along * p.uy + across * p.vy,
  ]

  const far = thickness
  const length = p.length

  ctx.beginPath()
  const corners = [at(0, 0), at(length, 0), at(length, far), at(0, far)]
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = theme.face
  ctx.fill()

  const tick = (along: number, from: number, to: number) => {
    const [x0, y0] = at(snap(along), from)
    const [x1, y1] = at(snap(along), to)
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
  }
  const pass = (color: string, devicePx: number, run: () => void) => {
    ctx.strokeStyle = color
    ctx.lineWidth = devicePx / dpr
    ctx.beginPath()
    run()
    ctx.stroke()
  }
  /** 숫자는 자가 기울어도 똑바로 세워 둡니다. */
  const label = (along: number, value: string, near: boolean) => {
    if (axis === 'h') {
      ctx.textAlign = 'left'
      ctx.textBaseline = near ? 'top' : 'bottom'
      const [x, y] = at(along + 3, near ? 22 : far - 22)
      ctx.fillText(value, x, y)
      return
    }
    if (axis === 'v') {
      ctx.textAlign = near ? 'left' : 'right'
      ctx.textBaseline = 'middle'
      const [x, y] = at(along + 2, near ? 24 : far - 24)
      ctx.fillText(value, x, y)
      return
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const [x, y] = at(along, near ? 30 : far - 30)
    ctx.fillText(value, x, y)
  }

  const mmCount = Math.floor(length / pxPerMm)
  const dense = pxPerMm >= 3

  pass(theme.sub, 1, () => {
    if (!dense) return
    for (let i = 0; i <= mmCount; i++) {
      if (i % 5 !== 0) tick(i * pxPerMm, 0, 7)
    }
  })
  pass(theme.ink, 1, () => {
    for (let i = 5; i <= mmCount; i += 5) {
      if (i % 10 !== 0) tick(i * pxPerMm, 0, 12)
    }
  })
  pass(theme.ink, 2, () => {
    for (let i = 0; i <= mmCount; i += 10) tick(i * pxPerMm, 0, 20)
  })

  const step = (pxPerMm * MM_PER_INCH) / 16
  const sixteenths = Math.floor(length / step)
  const fine = step >= 3

  pass(theme.sub, 1, () => {
    for (let i = 1; i <= sixteenths; i++) {
      if (i % 4 === 0) continue
      if (!fine && i % 2 !== 0) continue
      tick(i * step, far, far - (i % 2 === 0 ? 10 : 6))
    }
  })
  pass(theme.ink, 1, () => {
    for (let i = 4; i <= sixteenths; i += 4) {
      if (i % 16 !== 0) tick(i * step, far, far - (i % 8 === 0 ? 15 : 11))
    }
  })
  pass(theme.ink, 2, () => {
    for (let i = 0; i <= sixteenths; i += 16) tick(i * step, far, far - 20)
  })

  ctx.fillStyle = theme.ink
  label(2, 'cm', true)
  for (let i = 10; i <= mmCount; i += 10) label(i * pxPerMm, String(i / 10), true)
  label(2, 'in', false)
  for (let i = 16; i <= sixteenths; i += 16) label(i * step, String(i / 16), false)

  if (marker == null) return

  const mm = marker / pxPerMm
  const readout = `${mm.toFixed(1)}mm · ${(mm / MM_PER_INCH).toFixed(2)}"`
  const boxW = ctx.measureText(readout).width + 12
  const boxH = 20
  const flip = marker + 6 + boxW > length
  const boxAlong = flip ? marker - 6 - boxW : marker + 6
  const boxAcross = Math.round((thickness - boxH) / 2)

  pass(theme.accent, 2, () => tick(marker, 0, thickness))

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (axis === 'd') {
    const [cx, cy] = at(boxAlong + boxW / 2, thickness / 2)
    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 4)
    ctx.fill()
    ctx.fillStyle = theme.onAccent
    ctx.fillText(readout, cx, cy + 1)
    return
  }

  const [bx, by] = at(boxAlong, boxAcross)
  const vertical = axis === 'v'
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.roundRect(bx, by, vertical ? boxH : boxW, vertical ? boxW : boxH, 4)
  ctx.fill()

  ctx.fillStyle = theme.onAccent
  if (vertical) {
    ctx.save()
    ctx.translate(bx + boxH / 2, by + boxW / 2)
    ctx.rotate(Math.PI / 2)
    ctx.fillText(readout, 0, 1)
    ctx.restore()
  } else {
    ctx.fillText(readout, bx + boxW / 2, by + boxH / 2 + 1)
  }
}
