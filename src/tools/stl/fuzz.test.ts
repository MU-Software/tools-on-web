import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diagnose, repair, signedVolume } from './repair'
import { parseStl, writeStl } from './stl'
import { unionShells } from './union'
import { asciiStl, AUTO, cube, cylinderCaps, cylinderSide, flip, prismVolume, soup, type Tris } from './fixtures'

const MODELS: { name: string; t: Tris; volume: number; shells: number }[] = [
  { name: '정육면체', t: cube(), volume: 1, shells: 1 },
  { name: '면이 빠진 정육면체', t: cube().slice(2), volume: 1, shells: 1 },
  { name: '겹친 정육면체', t: [...cube(), ...cube([0.5, 0.5, 0.5])], volume: 1.875, shells: 1 },
  { name: '속이 빈 상자', t: [...cube([0, 0, 0], 3), ...cube([1, 1, 1]).map(flip)], volume: 26, shells: 2 },
  { name: '원기둥', t: [...cylinderSide(48, [0, 1]), ...cylinderCaps(48, 0, 1)], volume: prismVolume(48, 1), shells: 1 },
  { name: '떨어진 두 정육면체', t: [...cube(), ...cube([3, 0, 0])], volume: 2, shells: 2 },
]

describe('불변식: 옮기거나 키워도 결과가 같다', () => {
  for (const m of MODELS) {
    for (const [offset, scale] of [[0, 1], [7.3, 1e-3], [-250, 37], [1e4, 1e3]]) {
      it(`${m.name} (이동 ${offset}, 배율 ${scale})`, async () => {
        const positions = Float32Array.from(m.t.flat().map((x, i) => x * scale + offset * (1 + (i % 3) * 0.37)))
        const r = repair(positions, AUTO)
        const out = await unionShells(r.shells, true)
        const d = diagnose(out).diagnosis
        expect(d.closed).toBe(true)
        expect(d.shells).toBe(m.shells)
        expect(r.stats.outliers).toBe(0)
        // 작은 모델을 멀리 옮기면 float32 좌표 자체가 모델 크기의 0.1% 수준으로 뭉개지므로 상대 오차로 봅니다.
        const volume = signedVolume(out.verts, out.tris).volume / scale ** 3
        expect(Math.abs(volume - m.volume)).toBeLessThan(1e-3 * m.volume)
      })
    }
  }

  it.each([
    ['삼각형 하나', [[0, 0, 0, 10, 0, 0, 0, 10, 0]]],
    ['한 점으로 접힌 삼각형', [[0, 0, 0, 0, 0, 0, 0, 0, 0]]],
    ['면 세 개', cube().slice(0, 3)],
  ])('작은 입력(%s)도 던지지 않는다', async (_, t) => {
    const r = repair(soup(t as Tris), AUTO)
    await unionShells(r.shells, true)
    expect(r.stats.outliers).toBe(0)
  })
})

describe('망가진 바이트', () => {
  it('뒤집고 자르고 덧붙인 파일 400개에서 멈추거나 이상한 값을 내지 않는다', async () => {
    let seed = 12345
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const bases: Uint8Array[] = []
    for (const m of MODELS) {
      const positions = soup(m.t)
      const tris = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      bases.push(new Uint8Array(await writeStl(positions, tris, m.name).arrayBuffer()), new Uint8Array(asciiStl(m.t, m.name)))
    }
    let parsed = 0
    for (let iter = 0; iter < 400; iter++) {
      let bytes = bases[Math.floor(rand() * bases.length)].slice()
      const kind = Math.floor(rand() * 5)
      if (kind === 0) for (let k = 0; k < 1 + rand() * 20; k++) bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256)
      if (kind === 1) bytes = bytes.slice(0, Math.floor(rand() * bytes.length))
      if (kind === 2) {
        const tail = Uint8Array.from({ length: Math.floor(rand() * 300) }, () => (rand() < 0.5 ? 0 : Math.floor(rand() * 256)))
        const grown = new Uint8Array(bytes.length + tail.length)
        grown.set(bytes)
        grown.set(tail, bytes.length)
        bytes = grown
      }
      if (kind === 3 && bytes.length > 84) new DataView(bytes.buffer).setUint32(80, Math.floor(rand() * 2 ** 32), true)
      if (kind === 4) {
        for (let k = 0; k < 3; k++) {
          const at = 84 + Math.floor(rand() * Math.max(1, bytes.length - 88))
          if (at + 4 <= bytes.length) new DataView(bytes.buffer).setFloat32(at, [1e20, -1e30, 3e38, NaN, Infinity][Math.floor(rand() * 5)], true)
        }
      }
      let positions: Float32Array
      try {
        positions = parseStl(bytes.buffer as ArrayBuffer).positions
      } catch {
        continue
      }
      parsed++
      const started = performance.now()
      const r = repair(positions, AUTO)
      const out = await unionShells(r.shells, true)
      expect(performance.now() - started).toBeLessThan(3000)
      expect(out.verts.every(Number.isFinite)).toBe(true)
      expect(out.tris.every((v) => v < out.verts.length / 3)).toBe(true)
    }
    expect(parsed).toBeGreaterThan(200)
  }, 60000)
})

describe('면 구조가 깨진 ASCII', () => {
  it('줄을 빼거나 겹치거나 섞어도 다른 면의 꼭짓점을 섞은 삼각형을 만들지 않는다', () => {
    let seed = 777
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const t = [...cylinderSide(24, [0, 1]), ...cylinderCaps(24, 0, 1)]
    // 한 면 안에서 줄이 빠지고 겹치면 (v2, v2, v3)처럼 넓이 0인 면이 나올 수 있고 이는 뒤 단계가 걸러 냅니다.
    // 여기서 확인하는 것은 서로 다른 면의 꼭짓점이 한 삼각형에 섞이지 않는다는 점입니다.
    const point = (v: ArrayLike<number>, o: number) => [0, 1, 2].map((k) => Math.fround(v[o + k])).join(',')
    const facetsOf = new Map<string, Set<number>>()
    t.forEach((tri, f) => {
      for (let j = 0; j < 3; j++) {
        const p = point(tri, j * 3)
        if (!facetsOf.has(p)) facetsOf.set(p, new Set())
        facetsOf.get(p)!.add(f)
      }
    })
    const sameFacet = (v: Float32Array, o: number) => {
      const [a, b, c] = [0, 1, 2].map((j) => facetsOf.get(point(v, o + j * 3)) ?? new Set<number>())
      return [...a].some((f) => b.has(f) && c.has(f))
    }
    const base = new TextDecoder().decode(asciiStl(t, 'shape'))
    const mutations: ((lines: string[]) => string[])[] = [
      (l) => l.filter((x, i) => !(x.trim().startsWith('vertex') && i % 7 === Math.floor(rand() * 7))),
      (l) => l.flatMap((x) => (rand() < 0.05 ? [x, x] : [x])),
      (l) => l.filter((x) => !(x.trim() === 'endloop' && rand() < 0.5)),
      (l) => l.filter((x) => !(x.trim() === 'endfacet' && rand() < 0.5)),
      (l) => l.map((x) => (rand() < 0.3 ? x.toUpperCase() : x)),
      (l) => l.flatMap((x) => (rand() < 0.05 ? [x, 'garbage 1 2 3 vertexish'] : [x])),
      (l) => l.filter((x) => !(x.trim().startsWith('facet') && rand() < 0.3)),
    ]
    for (let iter = 0; iter < 300; iter++) {
      let lines = base.split('\n')
      for (const mutate of mutations) if (rand() < 0.4) lines = mutate(lines)
      const separator = ['\n', '\r', '\r\n', ' '][Math.floor(rand() * 4)]
      let positions: Float32Array
      try {
        positions = parseStl(new TextEncoder().encode(lines.join(separator)).buffer as ArrayBuffer).positions
      } catch {
        continue
      }
      expect(positions.length % 9).toBe(0)
      for (let o = 0; o < positions.length; o += 9) expect(sameFacet(positions, o)).toBe(true)
    }
  })
})

// 사용자가 지정한 실제 Blender 내보내기 파일. 그 파일이 있는 기기에서만 돕니다.
const REAL = '/Users/musoftware/workspace_3d/logicanalyzer_case/logicanalyzer_case.stl'

describe.skipIf(!existsSync(REAL))('실제 파일', () => {
  it('logicanalyzer_case.stl이 닫힌 입체가 된다', async () => {
    const raw = readFileSync(REAL)
    const soup = parseStl(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
    const r = repair(soup.positions, AUTO)
    const out = await unionShells(r.shells, true)
    const d = diagnose(out).diagnosis
    expect(d.closed).toBe(true)
    expect(d.shells).toBe(66)
    expect(r.stats.reversed).toBe(0)
    expect(r.stats.cavities).toBe(0)
  }, 60000)
})
