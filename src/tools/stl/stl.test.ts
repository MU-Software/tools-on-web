import { describe, expect, it } from 'vitest'
import { parseStl, writeStl } from './stl'
import { asciiStl, cube, cylinderSide, run, soup, type Tris } from './fixtures'

const binary = async (t: Tris, name = 'x') => {
  const positions = soup(t)
  const tris = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
  return new Uint8Array(await writeStl(positions, tris, name).arrayBuffer())
}

const withTail = (bytes: Uint8Array, tail: number, fill = 0) => {
  const out = new Uint8Array(bytes.length + tail).fill(fill)
  out.set(bytes)
  return out
}

const setCount = (bytes: Uint8Array, count: number) => new DataView(bytes.buffer).setUint32(80, count, true)

const triangles = (bytes: Uint8Array | ArrayBuffer) =>
  parseStl(bytes instanceof Uint8Array ? (bytes.buffer as ArrayBuffer) : bytes).positions.length / 9

describe('바이너리 STL', () => {
  it('쓰고 다시 읽으면 같고, 이름 앞에 접두어가 쌓이지 않는다', async () => {
    const parsed = parseStl((await binary(cube(), 'part')).buffer as ArrayBuffer)
    expect(parsed.format).toBe('binary')
    expect(parsed.name).toBe('part')
    expect(parsed.positions).toEqual(soup(cube()))
  })

  it('다른 프로그램이 쓴 "solidworks part" 헤더에서 solid로 시작하는 낱말을 잘라 내지 않는다', async () => {
    const bytes = await binary(cube())
    bytes.fill(0, 0, 80)
    bytes.set(new TextEncoder().encode('solidworks part'), 0)
    expect(parseStl(bytes.buffer as ArrayBuffer).name).toBe('solidworks part')
  })

  it('"solid"로 시작하는 헤더에 꼬리 바이트가 붙어도 바이너리로 읽는다', async () => {
    const bytes = withTail(await binary(cube()), 7)
    bytes.set(new TextEncoder().encode('solid exported'), 0)
    expect(triangles(bytes)).toBe(12)
  })

  it('쓰레기 꼬리 50바이트가 붙으면 헤더 수를 믿는다', async () => {
    expect(triangles(withTail(await binary(cube()), 50, 0x41))).toBe(12)
  })

  it('0으로 채운 꼬리는 삼각형으로 읽지 않는다', async () => {
    expect(triangles(withTail(await binary(cube([200, 200, 0])), 100))).toBe(12)
  })

  it('헤더 수가 0이면 크기에서 세되 0으로 채운 꼬리와 남는 바이트는 버린다', async () => {
    const zeroTail = withTail(await binary(cube()), 2000 * 50)
    setCount(zeroTail, 0)
    expect(triangles(zeroTail)).toBe(12)
    const stray = withTail(await binary(cube()), 2)
    setCount(stray, 0)
    expect(triangles(stray)).toBe(12)
  })

  it('헤더 수가 틀렸어도 뒤에 진짜 삼각형이 이어지면 모두 읽는다', async () => {
    const bytes = await binary([...cube(), ...cube([5, 0, 0])])
    setCount(bytes, 12)
    expect(triangles(bytes)).toBe(24)
    setCount(bytes, 0xffffffff)
    expect(triangles(bytes)).toBe(24)
  })

  it('받다 끊긴 파일은 온전한 삼각형까지 읽는다', async () => {
    const bytes = await binary([...cube(), ...cube([5, 0, 0])])
    expect(triangles(bytes.slice(0, bytes.length - 7))).toBe(23)
  })

  it('삼각형이 없으면 분명한 오류를 낸다', () => {
    expect(() => parseStl(new Uint8Array(84).buffer)).toThrow('삼각형이 하나도 없는')
  })
})

describe('ASCII STL', () => {
  it('읽는다', () => {
    const parsed = parseStl(asciiStl(cube(), 'cube'))
    expect(parsed.format).toBe('ascii')
    expect(parsed.name).toBe('cube')
    expect(parsed.positions).toEqual(soup(cube()))
  })

  it('float32 좌표를 그대로 되읽는다', () => {
    const t = [[200, 0, 0, 200.00001, 0, 0, 200, 1, 0]]
    expect(parseStl(asciiStl(t)).positions).toEqual(soup(t))
  })

  it('vertex 줄 하나가 빠지면 그 면만 버리고 뒤 면은 밀리지 않는다', async () => {
    const lines = new TextDecoder().decode(asciiStl(cube())).split('\n')
    lines.splice(lines.findIndex((l) => l.trim().startsWith('vertex')), 1)
    const parsed = parseStl(new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer)
    expect(parsed.positions).toEqual(soup(cube().slice(1)))
    const r = await run(cube().slice(1))
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(1, 6)
  })

  it('꼭짓점이 모자란 채 끝난 면은 다음 면과 섞지 않고 버린다', () => {
    const broken = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nfacet normal 0 0 1\nouter loop\nvertex 0 0 5\nvertex 1 0 5\nvertex 0 1 5\nendloop\nendfacet\nendsolid x\n'
    expect(Array.from(parseStl(new TextEncoder().encode(broken).buffer as ArrayBuffer).positions)).toEqual([0, 0, 5, 1, 0, 5, 0, 1, 5])
  })

  it('endloop 없이 이어지는 면도 셋씩 묶어 읽는다', () => {
    const text = new TextDecoder().decode(asciiStl(cube())).replace(/^\s*endloop\n/gm, '')
    expect(parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer).positions).toEqual(soup(cube()))
  })

  it('줄바꿈 없이 한 줄에 몰아 쓴 파일도 읽는다', () => {
    const text = new TextDecoder().decode(asciiStl(cube(), 'one line')).replace(/\s+/g, ' ')
    const parsed = parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer)
    expect(parsed.name).toBe('one line')
    expect(parsed.positions).toEqual(soup(cube()))
  })

  it('이름 줄의 "vertex"를 좌표로 읽지 않는다', () => {
    const parsed = parseStl(asciiStl(cube(), 'my vertex test part'))
    expect(parsed.positions).toEqual(soup(cube()))
  })

  it('줄바꿈이 \\r뿐인 옛 Mac 파일도 16MB 조각으로 나눠 읽는다', () => {
    const t = cylinderSide(40000, [0, 1])
    const text = new TextDecoder().decode(asciiStl(t)).replaceAll('\n', '\r')
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer
    expect(bytes.byteLength).toBeGreaterThan(16 << 20)
    expect(parseStl(bytes).positions).toEqual(soup(t))
  })

  it('16MB 조각을 넘는 파일도 조각 경계의 vertex까지 읽는다', () => {
    const t = cylinderSide(40000, [0, 1])
    const bytes = asciiStl(t)
    expect(bytes.byteLength).toBeGreaterThan(16 << 20)
    expect(parseStl(bytes).positions).toEqual(soup(t))
  })
})
