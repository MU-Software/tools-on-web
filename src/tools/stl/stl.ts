export type StlFormat = 'binary' | 'ascii'

export type Soup = {
  format: StlFormat
  name: string
  /** 삼각형마다 꼭짓점 셋, 9개씩 */
  positions: Float32Array
}

const decoder = new TextDecoder()

export function parseStl(buffer: ArrayBuffer): Soup {
  const soup = readStl(buffer)
  if (soup.positions.length === 0) throw new Error('삼각형이 하나도 없는 STL입니다')
  return soup
}

function readStl(buffer: ArrayBuffer): Soup {
  if (buffer.byteLength < 15) throw new Error('STL 파일이 아닙니다 (너무 작습니다)')
  const head = decoder.decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength)))

  const looksAscii = /^\s*solid/i.test(head) && isText(new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)))
  let count = -1
  let exact = false
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer)
    const declared = view.getUint32(80, true)
    const fromSize = (buffer.byteLength - 84) / 50
    const available = Math.floor(fromSize)
    exact = buffer.byteLength === 84 + 50 * declared
    if (declared > 0 && declared <= available) {
      // 꼬리 바이트가 붙은 파일도, 헤더 수를 틀리게 적는 내보내기 프로그램도 있어서
      // 헤더 뒤의 바이트가 진짜 삼각형처럼 보일 때만 크기를 믿습니다.
      count = !exact && Number.isInteger(fromSize) && looksLikeTriangles(view, declared, fromSize) ? fromSize : declared
    } else if (declared === 0) {
      // 스트리밍으로 쓰는 프로그램은 헤더 수를 0으로 남기기도 하므로 크기에서 셉니다.
      count = trimZeroTail(view, available)
    } else if (Number.isInteger(fromSize) && looksLikeTriangles(view, 0, fromSize)) {
      count = trimZeroTail(view, fromSize)
    } else if (declared > available && available > 0 && declared <= available * 2 && looksLikeTriangles(view, 0, available)) {
      // 받다 끊긴 파일은 온전한 삼각형까지 읽습니다. 절반도 없으면 STL이 아닌 파일로 봅니다.
      count = available
    }
  }
  // 바이너리 헤더도 "solid"로 시작하는 경우가 흔해서, 크기가 정확히 맞거나 앞부분이 글자가 아니면 바이너리로 봅니다.
  if (count >= 0 && (!looksAscii || exact)) return parseBinary(buffer, count, head)
  if (looksAscii) {
    try {
      return parseAscii(buffer)
    } catch (e) {
      if (count > 0) return parseBinary(buffer, count, head)
      throw e
    }
  }
  throw new Error('STL 파일이 아닙니다 (바이너리 크기가 맞지 않고 "solid"로 시작하지도 않습니다)')
}

/** 헤더 수를 믿지 못해 크기로 셀 때, 0으로 채운 꼬리 기록을 삼각형으로 읽지 않도록 잘라 냅니다. */
function trimZeroTail(view: DataView, count: number) {
  while (count > 0) {
    const base = 84 + (count - 1) * 50
    let zero = true
    for (let k = 0; k < 48 && zero; k += 4) zero = view.getUint32(base + k, true) === 0
    if (!zero) break
    count--
  }
  return count
}

/** 저장된 법선은 단위 벡터이거나 0이고 좌표는 유한하다는 점으로 진짜 삼각형인지 가늠합니다. */
function looksLikeTriangles(view: DataView, from: number, to: number) {
  for (let t = from; t < Math.min(to, from + 64); t++) {
    const base = 84 + t * 50
    const n = [0, 1, 2].map((k) => view.getFloat32(base + k * 4, true))
    const len = Math.hypot(n[0], n[1], n[2])
    if (!(len < 1e-6 || Math.abs(len - 1) < 0.01)) return false
    const p = Array.from({ length: 9 }, (_, k) => view.getFloat32(base + 12 + k * 4, true))
    if (!p.every(Number.isFinite)) return false
    // 0으로 채운 꼬리 바이트도 법선 0·좌표 0이라 위 검사를 통과하므로, 세 꼭짓점이 한 점인 면은 삼각형으로 보지 않습니다.
    if (p[0] === p[3] && p[3] === p[6] && p[1] === p[4] && p[4] === p[7] && p[2] === p[5] && p[5] === p[8]) return false
  }
  return true
}

function isText(bytes: Uint8Array) {
  for (const b of bytes) if (b < 9 || (b > 13 && b < 32)) return false
  return true
}

// 모서리·면 표에 쓰는 JS Map은 항목이 약 1,670만 개를 넘으면 엔진 오류를 내므로, 그 전에 분명히 거절합니다.
// 용접 격자·모서리 표는 삼각형 수의 최대 세 배까지 항목이 생기므로 그 3배가 한도 아래에 들도록 잡습니다.
const MAX_TRIANGLES = 5_000_000
const tooLarge = () => new Error(`삼각형이 ${MAX_TRIANGLES.toLocaleString('ko-KR')}개를 넘는 파일은 브라우저에서 다룰 수 없습니다`)

function parseBinary(buffer: ArrayBuffer, count: number, head: string): Soup {
  if (count > MAX_TRIANGLES) throw tooLarge()
  const view = new DataView(buffer)
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(base + k * 4, true)
  }
  return { format: 'binary', name: cleanName(head.replace(/^\s*solid(\s+|$)/i, '')), positions }
}

const ASCII_READ_CHUNK = 16 << 20

/** 큰 ASCII 파일을 한 문자열로 디코딩하면 V8의 최대 문자열 길이(약 5억 자)를 넘으므로 조각으로 나눠 읽습니다. */
function parseAscii(buffer: ArrayBuffer): Soup {
  const bytes = new Uint8Array(buffer)
  const stream = new TextDecoder()
  // 줄바꿈에 기대지 않고 낱말 흐름으로 읽습니다(한 줄에 몰아 쓴 파일도 있습니다). 이름 줄(solid my vertex part)에
  // 섞인 낱말을 좌표로 읽지 않도록 첫 facet이 나오기 전의 vertex는 버립니다.
  // 좌표 자리는 숫자처럼 시작하는 낱말만 받아, 이름 속 vertex가 뒤따르는 facet 낱말을 삼키지 않게 합니다.
  const num = '([-+.\\d][^\\s]*|nan|inf\\S*)'
  const re = new RegExp(`\\b(?:(vertex)\\s+${num}\\s+${num}\\s+${num}|(facet|endloop|endfacet)\\b)`, 'gi')
  // JS 배열은 값마다 8바이트 이상에 복사도 한 번 더 들어서, Float32Array를 두 배씩 늘려 바로 담습니다.
  let values = new Float32Array(1 << 16)
  let size = 0
  const push = (x: number) => {
    if (size >= MAX_TRIANGLES * 9) throw tooLarge()
    if (size === values.length) {
      const grown = new Float32Array(values.length * 2)
      grown.set(values)
      values = grown
    }
    values[size++] = x
  }
  // 꼭짓점을 면 단위로 모아, 줄이 빠지거나 남은 면만 버립니다. 9개씩 무작정 끊으면 그 뒤 면이 모두 밀립니다.
  const facet: number[] = []
  // 꼭짓점이 셋을 넘은 면(줄이 겹치거나, facet 줄이 빠져 두 면이 이어진 경우)은 어느 셋이 맞는지 알 수 없어 통째로 버립니다.
  let overflow = false
  const commit = () => {
    if (facet.length === 9 && !overflow) for (const x of facet) push(x)
    facet.length = 0
    overflow = false
  }
  let started = false
  let name: string | null = null
  let carry = ''
  for (let offset = 0; offset < bytes.length; offset += ASCII_READ_CHUNK) {
    const end = Math.min(bytes.length, offset + ASCII_READ_CHUNK)
    const last = end === bytes.length
    const text = carry + stream.decode(bytes.subarray(offset, end), { stream: !last })
    name ??= cleanName((/^\s*solid[ \t]*([^\r\n]*)/i.exec(text)?.[1] ?? '').split(/\s+facet\b/i)[0])
    // 꼭짓점 하나("vertex x y z")가 조각 사이에서 갈리지 않도록 마지막 vertex 앞에서 자르고 나머지는 다음 조각으로 넘깁니다.
    // 면 상태(facet)는 조각을 넘어 이어집니다.
    // 소문자로 바꾸면 길이가 달라지는 글자(İ 등)가 있어 원문에서 흔한 표기를 각각 찾습니다. 16MB 복사도 피합니다.
    const at = last ? -1 : Math.max(text.lastIndexOf('vertex'), text.lastIndexOf('VERTEX'), text.lastIndexOf('Vertex'))
    // 조각 맨 앞에만 vertex가 있으면(at === 0) 이번 조각은 통째로 다음으로 넘겨 그 꼭짓점이 갈리지 않게 합니다.
    const cut = last ? text.length : at >= 0 ? at : Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1
    carry = text.slice(cut)
    const body = text.slice(0, cut)
    re.lastIndex = 0
    for (let m = re.exec(body); m; m = re.exec(body)) {
      if (m[5]) {
        // endloop·endfacet이 빠진 면도 다음 facet 낱말에서 닫습니다.
        commit()
        if (m[5].toLowerCase() === 'facet') started = true
        continue
      }
      if (!started) continue
      if (facet.length === 9) overflow = true
      else facet.push(+m[2], +m[3], +m[4])
    }
  }
  commit()
  if (size === 0) throw new Error('ASCII STL에서 삼각형 하나를 이룰 vertex도 찾지 못했습니다')
  return { format: 'ascii', name: name ?? '', positions: values.slice(0, size) }
}

function cleanName(raw: string): string {
  return raw.replace(/\0[\s\S]*$/, '').replace(/[^\x20-\x7e]/g, '').trim()
}

export function writeStl(verts: Float32Array, tris: Uint32Array, name: string): Blob {
  const count = tris.length / 3
  const buffer = new ArrayBuffer(84 + count * 50)
  const view = new DataView(buffer)
  // 헤더가 "solid"로 시작하면 일부 프로그램이 ASCII로 오인합니다. 이름 앞에 무언가를 덧붙이면
  // 다시 수리할 때마다 쌓이므로, 이름이 "solid"로 시작할 때만 피해 갑니다.
  const label = !name ? 'tools-on-web' : /^\s*solid/i.test(name) ? `model ${name}` : name
  const header = new TextEncoder().encode(label).slice(0, 80)
  new Uint8Array(buffer, 0, header.length).set(header)
  view.setUint32(80, count, true)
  // 수백만 개를 메인 스레드에서 쓰므로 삼각형마다 배열을 만들지 않습니다.
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50
    const a = tris[t * 3] * 3
    const b = tris[t * 3 + 1] * 3
    const c = tris[t * 3 + 2] * 3
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2]
    const wx = verts[c] - verts[a], wy = verts[c + 1] - verts[a + 1], wz = verts[c + 2] - verts[a + 2]
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    view.setFloat32(base, nx / len, true)
    view.setFloat32(base + 4, ny / len, true)
    view.setFloat32(base + 8, nz / len, true)
    for (let k = 0; k < 3; k++) {
      view.setFloat32(base + 12 + k * 4, verts[a + k], true)
      view.setFloat32(base + 24 + k * 4, verts[b + k], true)
      view.setFloat32(base + 36 + k * 4, verts[c + k], true)
    }
  }
  return new Blob([buffer], { type: 'model/stl' })
}
