import {
  formatToLabel,
  prepareZXingModule,
  readBarcodes,
  type Point,
  type ReaderOptions,
  type ReadResult,
} from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
})

const MAX_IMAGE_SIDE = 4000
// 카메라는 매 프레임 디코딩하므로 더 작게 줄여 속도를 법니다.
const MAX_FRAME_SIDE = 1280

const OPTIONS: ReaderOptions = {
  formats: [],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 16,
  returnErrors: true,
}

export type Hit = {
  valid: boolean
  text: string
  error: string
  format: string
  label: string
  corners: Point[]
  orientation: number
  mirrored: boolean
  inverted: boolean
  version: string
  eccLevel: string
  byteLength: number
}

export type DecodeResult = {
  width: number
  height: number
  elapsedMs: number
  hits: Hit[]
}

/** 버전·ECC는 `extra` 안의 JSON으로 옵니다. */
function readExtra(raw: string): { version: string; eccLevel: string } {
  try {
    const extra = JSON.parse(raw) as Record<string, unknown>
    return {
      version: typeof extra.Version === 'string' ? extra.Version : '',
      eccLevel: typeof extra.ECLevel === 'string' ? extra.ECLevel : '',
    }
  } catch {
    return { version: '', eccLevel: '' }
  }
}

function toHit(result: ReadResult, scale: number): Hit {
  const { topLeft, topRight, bottomRight, bottomLeft } = result.position
  return {
    valid: result.isValid,
    text: result.text,
    error: result.error,
    format: result.format,
    label: formatToLabel(result.format) ?? result.format,
    corners: [topLeft, topRight, bottomRight, bottomLeft].map(({ x, y }) => ({
      x: x * scale,
      y: y * scale,
    })),
    orientation: result.orientation,
    mirrored: result.isMirrored,
    inverted: result.isInverted,
    ...readExtra(result.extra),
    byteLength: result.bytes.length,
  }
}

function paint(drawable: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('캔버스 컨텍스트를 만들 수 없습니다')
  // 알파는 그레이스케일 변환에서 버려집니다. 배경이 투명한 PNG를 온통 검은 이미지로
  // 만들지 않으려면 흰 바탕에 합성해야 합니다.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(drawable, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

async function decode(
  drawable: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number,
): Promise<DecodeResult> {
  const ratio = Math.min(1, maxSide / Math.max(width, height))
  const w = Math.max(1, Math.round(width * ratio))
  const h = Math.max(1, Math.round(height * ratio))

  const pixels = paint(drawable, w, h)
  const started = performance.now()
  const results = await readBarcodes(pixels, OPTIONS)
  const elapsedMs = performance.now() - started

  // 좌표는 미리보기와 맞도록 원본 크기로 되돌립니다.
  return { width, height, elapsedMs, hits: results.map((r) => toHit(r, width / w)) }
}

/** Blob을 그대로 넘기면 wasm 내부 디코더라 WebP·HEIC를 놓치므로, 브라우저로 디코딩해 픽셀을 넘깁니다. */
export async function decodeImage(blob: Blob): Promise<DecodeResult> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    return await decode(bitmap, bitmap.width, bitmap.height, MAX_IMAGE_SIDE)
  } finally {
    bitmap.close()
  }
}

export function decodeFrame(video: HTMLVideoElement): Promise<DecodeResult> {
  return decode(video, video.videoWidth, video.videoHeight, MAX_FRAME_SIDE)
}

export async function captureFrame(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스 컨텍스트를 만들 수 없습니다')
  ctx.drawImage(video, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('카메라 화면을 캡처하지 못했습니다')
  return new File([blob], 'camera.png', { type: 'image/png' })
}
