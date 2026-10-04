import { diagnose, repair, signedVolume, type RepairOptions } from './repair'
import { unionShells } from './union'

/** 테스트용 메시 조각. 삼각형마다 좌표 9개 */
export type Tris = number[][]

export const AUTO: RepairOptions = { weldTolerance: 'auto', stitchGap: 'auto', fillHoles: true, removeFragments: true }

export function cube(o = [0, 0, 0], s = 1): Tris {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) =>
    p.map((x, k) => o[k] + x * s),
  )
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return f.map((t) => t.flatMap((i) => v[i]))
}

export const flip = (t: number[]) => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)]

export const soup = (t: Tris) => Float32Array.from(t.flat())

/** 단위 정육면체 칸을 채운 덩어리의 겉면 */
export function voxels(cells: number[][]): Tris {
  const key = (c: number[]) => c.join(',')
  const set = new Set(cells.map(key))
  const out: Tris = []
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (const c of cells) {
    for (const d of dirs) {
      if (set.has(key(c.map((x, k) => x + d[k])))) continue
      const ax = d.findIndex((x) => x !== 0)
      const u = (ax + 1) % 3
      const v = (ax + 2) % 3
      const corner = (i: number, j: number) => {
        const p = [...c]
        p[ax] += d[ax] > 0 ? 1 : 0
        p[u] += i
        p[v] += j
        return p
      }
      const q = d[ax] > 0 ? [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] : [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)]
      out.push([...q[0], ...q[1], ...q[2]], [...q[0], ...q[2], ...q[3]])
    }
  }
  return out
}

/** 반지름 r, 높이 rows 끝값의 원기둥 옆면. skip(i, r)이 참인 칸은 비웁니다. 위·아래 뚜껑은 따로 붙입니다. */
export function cylinderSide(n: number, rows: number[], skip: (i: number, r: number) => boolean = () => false, radius = 1): Tris {
  const p = (i: number, z: number) => [radius * Math.cos((2 * Math.PI * i) / n), radius * Math.sin((2 * Math.PI * i) / n), z]
  const t: Tris = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    for (let r = 0; r + 1 < rows.length; r++) {
      if (skip(i, r)) continue
      t.push([...p(i, rows[r]), ...p(j, rows[r]), ...p(j, rows[r + 1])], [...p(i, rows[r]), ...p(j, rows[r + 1]), ...p(i, rows[r + 1])])
    }
  }
  return t
}

export function cylinderCaps(n: number, bottom: number, top: number, radius = 1): Tris {
  const p = (i: number, z: number) => [radius * Math.cos((2 * Math.PI * i) / n), radius * Math.sin((2 * Math.PI * i) / n), z]
  const t: Tris = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    t.push([0, 0, bottom, ...p(j, bottom), ...p(i, bottom)], [0, 0, top, ...p(i, top), ...p(j, top)])
  }
  return t
}

/** 정다각형 n각형 기둥의 부피 */
export const prismVolume = (n: number, height: number, radius = 1) => (n / 2) * radius * radius * Math.sin((2 * Math.PI) / n) * height

export async function run(t: Tris, options: Partial<RepairOptions> = {}, union = true) {
  const repaired = repair(soup(t), { ...AUTO, ...options })
  const merged = await unionShells(repaired.shells, union)
  const diagnosis = diagnose(merged).diagnosis
  const volume = signedVolume(merged.verts, merged.tris).volume
  const filled = merged.filled.reduce((sum, f) => sum + f, 0)
  return { repaired, stats: repaired.stats, merged, diagnosis, volume, filled }
}

export function asciiStl(t: Tris, name = 'test') {
  const f = (x: number) => Math.fround(x).toExponential(8)
  const lines = [`solid ${name}`]
  for (const tri of t) {
    lines.push('  facet normal 0 0 0', '    outer loop')
    for (let j = 0; j < 3; j++) lines.push(`      vertex ${f(tri[j * 3])} ${f(tri[j * 3 + 1])} ${f(tri[j * 3 + 2])}`)
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer
}
