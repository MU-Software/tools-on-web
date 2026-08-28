export type MediaKind = 'image' | 'audio' | 'video' | 'text' | 'binary'

export type Media = {
  mime: string
  ext: string
  kind: MediaKind
}

type Signature = {
  offset: number
  magic: string
  /** RIFF·ftyp처럼 컨테이너가 같아 뒤쪽 태그로만 갈리는 포맷을 위한 2차 확인 */
  also?: { offset: number; magic: string }
  media: Media
}

const image = (mime: string, ext: string): Media => ({ mime, ext, kind: 'image' })
const audio = (mime: string, ext: string): Media => ({ mime, ext, kind: 'audio' })
const video = (mime: string, ext: string): Media => ({ mime, ext, kind: 'video' })
const binary = (mime: string, ext: string): Media => ({ mime, ext, kind: 'binary' })

const SIGNATURES: Signature[] = [
  { offset: 0, magic: '89504e470d0a1a0a', media: image('image/png', 'png') },
  { offset: 0, magic: 'ffd8ff', media: image('image/jpeg', 'jpg') },
  { offset: 0, magic: '474946383961', media: image('image/gif', 'gif') },
  { offset: 0, magic: '474946383761', media: image('image/gif', 'gif') },
  { offset: 0, magic: '424d', media: image('image/bmp', 'bmp') },
  { offset: 0, magic: '00000100', media: image('image/x-icon', 'ico') },
  { offset: 0, magic: '52494646', also: { offset: 8, magic: '57454250' }, media: image('image/webp', 'webp') },
  { offset: 0, magic: '52494646', also: { offset: 8, magic: '57415645' }, media: audio('audio/wav', 'wav') },
  { offset: 0, magic: '52494646', also: { offset: 8, magic: '41564920' }, media: video('video/x-msvideo', 'avi') },
  { offset: 0, magic: '464f524d', also: { offset: 8, magic: '41494646' }, media: audio('audio/aiff', 'aiff') },
  { offset: 0, magic: '464f524d', also: { offset: 8, magic: '41494643' }, media: audio('audio/aiff', 'aifc') },
  { offset: 0, magic: '4d546864', media: audio('audio/midi', 'mid') },
  { offset: 0, magic: '494433', media: audio('audio/mpeg', 'mp3') },
  { offset: 0, magic: 'fff1', media: audio('audio/aac', 'aac') },
  { offset: 0, magic: 'fff9', media: audio('audio/aac', 'aac') },
  { offset: 0, magic: 'fffb', media: audio('audio/mpeg', 'mp3') },
  { offset: 0, magic: 'fff3', media: audio('audio/mpeg', 'mp3') },
  { offset: 0, magic: '4f676753', media: audio('audio/ogg', 'ogg') },
  { offset: 0, magic: '664c6143', media: audio('audio/flac', 'flac') },
  { offset: 0, magic: '49492a00', media: image('image/tiff', 'tif') },
  { offset: 0, magic: '4d4d002a', media: image('image/tiff', 'tif') },
  { offset: 4, magic: '66747970', also: { offset: 8, magic: '61766966' }, media: image('image/avif', 'avif') },
  { offset: 4, magic: '66747970', also: { offset: 8, magic: '68656963' }, media: image('image/heic', 'heic') },
  { offset: 4, magic: '66747970', also: { offset: 8, magic: '4d3441' }, media: audio('audio/mp4', 'm4a') },
  { offset: 4, magic: '66747970', also: { offset: 8, magic: '71742020' }, media: video('video/quicktime', 'mov') },
  { offset: 4, magic: '66747970', media: video('video/mp4', 'mp4') },
  { offset: 0, magic: '1a45dfa3', media: video('video/webm', 'webm') },
  { offset: 0, magic: '25504446', media: binary('application/pdf', 'pdf') },
  { offset: 0, magic: '504b0304', media: binary('application/zip', 'zip') },
  { offset: 0, magic: '1f8b', media: binary('application/gzip', 'gz') },
  { offset: 0, magic: '7f454c46', media: binary('application/x-elf', 'elf') },
]

function matchesAt(bytes: Uint8Array, offset: number, magic: string): boolean {
  const length = magic.length / 2
  if (bytes.length < offset + length) return false
  for (let i = 0; i < length; i++) {
    if (bytes[offset + i] !== parseInt(magic.slice(i * 2, i * 2 + 2), 16)) return false
  }
  return true
}

const TEXT = { mime: 'text/plain', ext: 'txt', kind: 'text' } as const
const UNKNOWN = { mime: 'application/octet-stream', ext: 'bin', kind: 'binary' } as const

/** 매직 넘버로 형식을 추정합니다. 아무것도 걸리지 않으면 UTF-8 여부로 텍스트와 바이너리를 가릅니다. */
export function sniff(bytes: Uint8Array, isText: boolean): Media {
  for (const sig of SIGNATURES) {
    if (!matchesAt(bytes, sig.offset, sig.magic)) continue
    if (sig.also && !matchesAt(bytes, sig.also.offset, sig.also.magic)) continue
    return sig.media
  }
  if (!isText) return UNKNOWN
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  if (/^(<\?xml[^>]*\?>\s*(<!--.*?-->\s*)*)?<svg[\s>]/is.test(head)) return image('image/svg+xml', 'svg')
  if (/^[[{]/.test(head)) return { mime: 'application/json', ext: 'json', kind: 'text' }
  return TEXT
}
