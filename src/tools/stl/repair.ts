import { buildEdges, centroid, compactVertices, cross, dedupe, disjointSet, dist2, edgeSize, gridAdd, gridQuery, makeGrid, nextHalf, triNormal, type Edges } from './mesh'
import { stitch } from './stitch'

export type Mesh = { verts: Float32Array; tris: Uint32Array }

export type RepairOptions = {
  /** mm. 'auto'는 경계 상자 대각선의 100만분의 1 */
  weldTolerance: number | 'auto'
  /** mm. 열린 모서리끼리 꿰맬 최대 틈, 0이면 끔. 'auto'는 대각선의 5000분의 1(최대 0.05 mm) */
  stitchGap: number | 'auto'
  fillHoles: boolean
  removeFragments: boolean
}

export type Diagnosis = {
  vertices: number
  triangles: number
  boundaryEdges: number
  nonManifoldEdges: number
  inconsistentEdges: number
  shells: number
  closed: boolean
}

export type Shell = Mesh & {
  /** 구멍 메우기로 새로 생긴 삼각형 */
  filled: Uint8Array
  closed: boolean
  volume: number
  /** 다른 셸 안에 있고 원래 법선도 안쪽을 향하던 빈 공간 */
  cavity: boolean
  /** 바로 바깥 셸의 번호, 없으면 -1 */
  parent: number
}

export type RepairStats = {
  nonFinite: number
  outliers: number
  weldTolerance: number
  rawVertices: number
  weldedVertices: number
  degenerate: number
  duplicate: number
  internal: number
  stitchGap: number
  stitched: number
  tJunctions: number
  pinches: number
  reversed: number
  nonOrientable: number
  holesFilled: number
  holesUnfilled: number
  fillTriangles: number
  fragmentsRemoved: number
  cavities: number
  nestedVoids: number
  openShells: number
}

export type RepairResult = {
  before: Mesh
  beforeDiagnosis: Diagnosis
  boundaryLines: Uint32Array
  nonManifoldLines: Uint32Array
  shells: Shell[]
  stats: RepairStats
}

const MAX_EAR_CLIP = 500

export function bounds(verts: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (verts[i + k] < min[k]) min[k] = verts[i + k]
      if (verts[i + k] > max[k]) max[k] = verts[i + k]
    }
  }
  return { min, max }
}

const diagonal = ({ min, max }: { min: number[]; max: number[] }) =>
  min[0] > max[0] ? 0 : Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])

/** 조건에 맞는 삼각형만 남깁니다. 보통은 모두 맞으므로 먼저 세어 보고 그때만 복사합니다. */
function filterTriangles(positions: Float32Array, ok: (t: number) => boolean) {
  const count = positions.length / 9
  let kept = 0
  for (let t = 0; t < count; t++) if (ok(t)) kept++
  if (kept === count) return { positions, dropped: 0 }
  const out = new Float32Array(kept * 9)
  let at = 0
  for (let t = 0; t < count; t++) if (ok(t)) out.set(positions.subarray(t * 9, t * 9 + 9), 9 * at++)
  return { positions: out, dropped: count - kept }
}

function weld(positions: Float32Array, tolerance: number, cell: number): Mesh {
  const n = positions.length / 3
  const verts = new Float32Array(positions.length)
  const tris = new Uint32Array(n)
  const grid = makeGrid(cell)
  const tol2 = tolerance * tolerance
  let count = 0
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    let found = -1
    gridQuery(grid, [x - tolerance, y - tolerance, z - tolerance], [x + tolerance, y + tolerance, z + tolerance], (v) => {
      const dx = verts[v * 3] - x
      const dy = verts[v * 3 + 1] - y
      const dz = verts[v * 3 + 2] - z
      if (dx * dx + dy * dy + dz * dz > tol2) return false
      found = v
      return true
    })
    if (found < 0) {
      found = count++
      verts[found * 3] = x
      verts[found * 3 + 1] = y
      verts[found * 3 + 2] = z
      gridAdd(grid, x, y, z, found)
    }
    tris[i] = found
  }
  return { verts: verts.slice(0, count * 3), tris }
}

export function diagnose({ verts, tris }: Mesh, known?: Edges) {
  const edges = known ?? buildEdges(tris, verts.length / 3)
  const boundary: number[] = []
  const nonManifold: number[] = []
  let inconsistent = 0
  for (let e = 0; e < edges.count; e++) {
    const size = edgeSize(edges, e)
    const h = edges.halves[edges.start[e]]
    const pair = [tris[h], tris[nextHalf(h)]]
    if (size === 1) boundary.push(...pair)
    else if (size > 2) nonManifold.push(...pair)
    else if (tris[edges.halves[edges.start[e] + 1]] === tris[h]) inconsistent++
  }

  const { parent, root } = disjointSet(tris.length / 3)
  for (let e = 0; e < edges.count; e++) {
    const first = root((edges.halves[edges.start[e]] / 3) | 0)
    for (let j = edges.start[e] + 1; j < edges.start[e + 1]; j++) parent[root((edges.halves[j] / 3) | 0)] = first
  }
  let shells = 0
  for (let t = 0; t < parent.length; t++) if (root(t) === t) shells++

  const diagnosis: Diagnosis = {
    vertices: verts.length / 3,
    triangles: tris.length / 3,
    boundaryEdges: boundary.length / 2,
    nonManifoldEdges: nonManifold.length / 2,
    inconsistentEdges: inconsistent,
    shells,
    closed: boundary.length === 0 && nonManifold.length === 0 && inconsistent === 0 && tris.length > 0,
  }
  return {
    diagnosis,
    boundaryLines: Uint32Array.from(boundary),
    nonManifoldLines: Uint32Array.from(nonManifold),
    edges,
  }
}

/** 두 면을 지나는 모서리로만 이어진 덩어리를 찾으며, 이웃과 감김 방향을 맞춥니다. */
function orient(tris: Uint32Array, edges: Edges) {
  const triCount = tris.length / 3
  const component = new Int32Array(triCount).fill(-1)
  const flip = new Uint8Array(triCount)
  const conflicted: boolean[] = []
  const queue = new Int32Array(triCount)
  let components = 0

  for (let seed = 0; seed < triCount; seed++) {
    if (component[seed] >= 0) continue
    const c = components++
    conflicted.push(false)
    component[seed] = c
    let head = 0
    let tail = 0
    queue[tail++] = seed
    while (head < tail) {
      const t = queue[head++]
      for (let i = 0; i < 3; i++) {
        const h = t * 3 + i
        const e = edges.edgeOf[h]
        if (edgeSize(edges, e) !== 2) continue
        const first = edges.halves[edges.start[e]]
        const g = first === h ? edges.halves[edges.start[e] + 1] : first
        const s = (g / 3) | 0
        if (s === t) continue
        const expected = flip[t] ^ (tris[g] === tris[h] ? 1 : 0)
        if (component[s] < 0) {
          component[s] = c
          flip[s] = expected
          queue[tail++] = s
        } else if (flip[s] !== expected) {
          conflicted[c] = true
        }
      }
    }
  }
  return { component, flip, components, conflicted }
}

/**
 * 한 덩어리가 모서리에서 자기 자신과 맞닿으면 그 모서리에 면이 넷 이상 모입니다.
 * 면을 모서리 둘레 각도순으로 세워 안쪽(입체)을 사이에 둔 것끼리 짝짓고,
 * 짝을 따라 꼭짓점을 부채꼴마다 나눠 위상을 떼어 냅니다.
 */
function splitPinches(verts: number[], tris: number[], edges: Edges): number {
  const twin = new Int32Array(tris.length).fill(-1)
  let pinched = 0
  for (let e = 0; e < edges.count; e++) {
    const size = edgeSize(edges, e)
    const first = edges.halves[edges.start[e]]
    if (size === 2) {
      const second = edges.halves[edges.start[e] + 1]
      if (tris[first] !== tris[second]) {
        twin[first] = second
        twin[second] = first
      }
      continue
    }
    if (size < 3) continue
    const hs = Array.from(edges.halves.subarray(edges.start[e], edges.start[e + 1]))
    pinched++
    const a = tris[hs[0]]
    const b = tris[nextHalf(hs[0])]
    const d = [0, 1, 2].map((k) => verts[b * 3 + k] - verts[a * 3 + k])
    const helper = Math.abs(d[0]) < Math.abs(d[1]) ? [1, 0, 0] : [0, 1, 0]
    const e1 = cross(d, helper)
    const e2 = cross(d, e1)
    const fan = hs
      .map((h) => {
        const c = tris[nextHalf(nextHalf(h))]
        const w = [0, 1, 2].map((k) => verts[c * 3 + k] - verts[a * 3 + k])
        const angle = Math.atan2(w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2], w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2])
        return { h, forward: tris[h] === a, angle }
      })
      .sort((p, q) => p.angle - q.angle)
    // a→b를 축으로 반시계로 돌 때, 역방향 면 바로 다음의 정방향 면까지가 입체입니다.
    const paired = new Set<number>()
    for (let i = 0; i < fan.length; i++) {
      const cur = fan[i]
      const next = fan[(i + 1) % fan.length]
      if (cur.forward || !next.forward || paired.has(cur.h) || paired.has(next.h)) continue
      twin[cur.h] = next.h
      twin[next.h] = cur.h
      paired.add(cur.h).add(next.h)
    }
  }
  if (pinched === 0) return 0

  const { parent, root } = disjointSet(tris.length)
  for (let h = 0; h < tris.length; h++) {
    const back = twin[h % 3 === 0 ? h + 2 : h - 1]
    if (back >= 0) parent[root(h)] = root(back)
  }
  const copies = new Map<number, number>()
  const source = tris.slice()
  const positions = verts.slice()
  verts.length = 0
  for (let h = 0; h < tris.length; h++) {
    const r = root(h)
    let v = copies.get(r)
    if (v === undefined) {
      v = verts.length / 3
      copies.set(r, v)
      verts.push(positions[source[h] * 3], positions[source[h] * 3 + 1], positions[source[h] * 3 + 2])
    }
    tris[h] = v
  }
  return pinched
}

function newell(verts: number[], loop: number[]): [number, number, number] {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3
    const b = loop[(i + 1) % loop.length] * 3
    nx += (verts[a + 1] - verts[b + 1]) * (verts[a + 2] + verts[b + 2])
    ny += (verts[a + 2] - verts[b + 2]) * (verts[a] + verts[b])
    nz += (verts[a] - verts[b]) * (verts[a + 1] + verts[b + 1])
  }
  return [nx, ny, nz]
}

function earClip(verts: number[], loop: number[]): number[] | null {
  const [nx, ny, nz] = newell(verts, loop)
  const len = Math.hypot(nx, ny, nz)
  if (len === 0) return null
  const n = [nx / len, ny / len, nz / len]
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const dot = helper[0] * n[0] + helper[1] * n[1] + helper[2] * n[2]
  const e1 = [helper[0] - dot * n[0], helper[1] - dot * n[1], helper[2] - dot * n[2]]
  const l1 = Math.hypot(e1[0], e1[1], e1[2])
  e1.forEach((_, k) => (e1[k] /= l1))
  const e2 = cross(n, e1)

  const px = loop.map((v) => verts[v * 3] * e1[0] + verts[v * 3 + 1] * e1[1] + verts[v * 3 + 2] * e1[2])
  const py = loop.map((v) => verts[v * 3] * e2[0] + verts[v * 3 + 1] * e2[1] + verts[v * 3 + 2] * e2[2])
  const turn = (a: number, b: number, c: number) =>
    (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a])

  const ring = loop.map((_, i) => i)
  const out: number[] = []
  while (ring.length > 3) {
    let clipped = false
    for (let i = 0; i < ring.length && !clipped; i++) {
      const a = ring[(i + ring.length - 1) % ring.length]
      const b = ring[i]
      const c = ring[(i + 1) % ring.length]
      if (turn(a, b, c) <= 0) continue
      const blocked = ring.some(
        (p) => p !== a && p !== b && p !== c && turn(a, b, p) > 0 && turn(b, c, p) > 0 && turn(c, a, p) > 0,
      )
      if (blocked) continue
      out.push(loop[a], loop[b], loop[c])
      ring.splice(i, 1)
      clipped = true
    }
    if (!clipped) return null
  }
  out.push(loop[ring[0]], loop[ring[1]], loop[ring[2]])
  return out
}

type Loop = { verts: number[]; thirds: number[] }

/** 구멍 둘레의 고리를 찾습니다. 각 고리는 기존 면의 변 방향을 따르고, 변마다 그 면의 나머지 꼭짓점을 함께 적습니다. */
function traceHoles(tris: number[], edges: Edges) {
  const outgoing = new Map<number, { to: number; third: number }[]>()
  for (let e = 0; e < edges.count; e++) {
    if (edgeSize(edges, e) !== 1) continue
    const h = edges.halves[edges.start[e]]
    const edge = { to: tris[nextHalf(h)], third: tris[nextHalf(nextHalf(h))] }
    const list = outgoing.get(tris[h])
    if (list) list.push(edge)
    else outgoing.set(tris[h], [edge])
  }

  const loops: Loop[] = []
  let broken = 0
  for (const [origin, targets] of outgoing) {
    while (targets.length) {
      const loop: [number, number][] = []
      const at = new Map<number, number>()
      let from = origin
      let edge = targets.pop()!
      for (;;) {
        at.set(from, loop.length)
        loop.push([from, edge.third])
        const cur = edge.to
        if (cur === origin) {
          loops.push({ verts: loop.map(([v]) => v), thirds: loop.map(([, t]) => t) })
          break
        }
        // 한 꼭짓점에서 두 구멍이 맞닿으면 8자 고리가 되므로 거기서 떼어 냅니다.
        const seen = at.get(cur)
        if (seen !== undefined) {
          const sub = loop.splice(seen)
          sub.forEach(([v]) => at.delete(v))
          loops.push({ verts: sub.map(([v]) => v), thirds: sub.map(([, t]) => t) })
        }
        const nextTargets = outgoing.get(cur)
        if (!nextTargets?.length) {
          broken++
          break
        }
        from = cur
        edge = nextTargets.pop()!
      }
    }
  }
  return { loops, broken }
}

const MAX_LIEPA = 200

/** 법선 표 a의 o번째와 b의 q번째 사이 각. 넓이 없는 면은 직각으로 봅니다. */
function angleAt(a: ArrayLike<number>, o: number, b: ArrayLike<number>, q: number) {
  const ax = a[o], ay = a[o + 1], az = a[o + 2]
  const bx = b[q], by = b[q + 1], bz = b[q + 2]
  const len = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)
  if (len === 0) return Math.PI / 2
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / len)))
}

/**
 * Liepa(2003)의 동적 계획법. 이웃 면과 이루는 이면각의 최댓값이 가장 작은 삼각분할을 고르고,
 * 같으면 넓이가 작은 쪽을 고릅니다. 굽은 면에 난 구멍이 평평한 뚜껑으로 덮이지 않습니다.
 * neighbors[k]는 p[k]→p[k+1] 변 건너편 기존 면의 법선입니다.
 */
function liepa(verts: number[], p: number[], neighbors: number[][]): number[] {
  const n = p.length
  const at = (i: number, j: number) => i * n + j
  const worst = new Float64Array(n * n)
  const area = new Float64Array(n * n)
  const pick = new Int32Array(n * n).fill(-1)
  // O(n³) 안쪽 고리에서 배열을 만들지 않도록 좌표·이웃 법선·부분해에서 고른 면의 법선을 평평한 표에 둡니다.
  const pos = new Float64Array(n * 3)
  const edge = new Float64Array(n * 3)
  const chosen = new Float64Array(n * n * 3)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = verts[p[i] * 3 + k]
      edge[i * 3 + k] = neighbors[i][k]
    }
  }
  const tri = new Float64Array(3)
  const side = (i: number, j: number): [Float64Array, number] => (j === i + 1 ? [edge, i * 3] : [chosen, at(i, j) * 3])

  for (let len = 2; len < n; len++) {
    for (let i = 0; i + len < n; i++) {
      const j = i + len
      let bestWorst = Infinity
      let bestArea = Infinity
      for (let m = i + 1; m < j; m++) {
        const ux = pos[m * 3] - pos[i * 3], uy = pos[m * 3 + 1] - pos[i * 3 + 1], uz = pos[m * 3 + 2] - pos[i * 3 + 2]
        const wx = pos[j * 3] - pos[i * 3], wy = pos[j * 3 + 1] - pos[i * 3 + 1], wz = pos[j * 3 + 2] - pos[i * 3 + 2]
        tri[0] = uy * wz - uz * wy
        tri[1] = uz * wx - ux * wz
        tri[2] = ux * wy - uy * wx
        const [left, lo] = side(i, m)
        const [right, ro] = side(m, j)
        let w = Math.max(worst[at(i, m)], worst[at(m, j)], angleAt(tri, 0, left, lo), angleAt(tri, 0, right, ro))
        if (i === 0 && j === n - 1) w = Math.max(w, angleAt(tri, 0, edge, (n - 1) * 3))
        const a = area[at(i, m)] + area[at(m, j)] + Math.hypot(tri[0], tri[1], tri[2]) / 2
        if (w < bestWorst - 1e-9 || (w <= bestWorst + 1e-9 && a < bestArea)) {
          bestWorst = w
          bestArea = a
          pick[at(i, j)] = m
          chosen.set(tri, at(i, j) * 3)
        }
      }
      worst[at(i, j)] = bestWorst
      area[at(i, j)] = bestArea
    }
  }

  const out: number[] = []
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    if (j - i < 2) continue
    const m = pick[at(i, j)]
    out.push(p[i], p[m], p[j])
    stack.push([i, m], [m, j])
  }
  return out
}

/** 둘레가 맞춘 평면에서 지름의 1% 안에 들면 평평한 구멍으로 봅니다. */
function isPlanar(verts: number[], loop: number[]) {
  const [nx, ny, nz] = newell(verts, loop)
  const len = Math.hypot(nx, ny, nz)
  if (len === 0) return false
  const c = centroid(verts, loop)
  let deviation = 0
  let radius = 0
  for (const v of loop) {
    const d = [verts[v * 3] - c[0], verts[v * 3 + 1] - c[1], verts[v * 3 + 2] - c[2]]
    deviation = Math.max(deviation, Math.abs(d[0] * nx + d[1] * ny + d[2] * nz) / len)
    radius = Math.max(radius, Math.hypot(d[0], d[1], d[2]))
  }
  return deviation <= 0.01 * 2 * radius
}

function fillHoles(verts: number[], tris: number[], filled: number[], edges: Edges) {
  const { loops, broken } = traceHoles(tris, edges)
  for (const boundary of loops) {
    // 메우는 면은 둘레를 기존 면과 반대 방향으로 돌아야 바깥을 향합니다.
    const n = boundary.verts.length
    const loop = boundary.verts.slice().reverse()
    let added: number[] | null = n === 3 ? loop : null
    if (!added) {
      const ear = () => (n <= MAX_EAR_CLIP ? earClip(verts, loop) : null)
      const dp = () => {
        if (n > MAX_LIEPA) return null
        // 뒤집은 고리의 k번째 변은 원래 고리의 (n-2-k)번째 변을 거꾸로 지난 것입니다.
        const neighbors = loop.map((v, k) => {
          const third = boundary.thirds[(2 * n - 2 - k) % n]
          return triNormal(verts, loop[(k + 1) % n], v, third)
        })
        return liepa(verts, loop, neighbors)
      }
      // 둘레에 일직선으로 놓인 꼭짓점(T자 이음 자리 등)이 있으면 넓이 0인 면이 생길 수 있어, 그런 결과는 다음 방법으로 넘깁니다.
      for (const method of isPlanar(verts, loop) ? [ear, dp] : [dp, ear]) {
        const candidate = method()
        if (candidate && !isDegenerate(verts, candidate)) {
          added = candidate
          break
        }
      }
    }
    if (!added) {
      const c = verts.length / 3
      verts.push(...centroid(verts, loop))
      added = loop.flatMap((v, i) => [v, loop[(i + 1) % loop.length], c])
    }
    for (let i = 0; i < added.length; i++) tris.push(added[i])
    for (let i = 0; i < added.length / 3; i++) filled.push(1)
  }
  return { holes: loops.length, broken }
}

export function signedVolume(verts: ArrayLike<number>, tris: ArrayLike<number>, origin = [0, 0, 0]) {
  let volume = 0
  let area = 0
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3
    const b = tris[t + 1] * 3
    const c = tris[t + 2] * 3
    const [ax, ay, az] = [verts[a] - origin[0], verts[a + 1] - origin[1], verts[a + 2] - origin[2]]
    const [bx, by, bz] = [verts[b] - verts[a], verts[b + 1] - verts[a + 1], verts[b + 2] - verts[a + 2]]
    const [cx, cy, cz] = [verts[c] - verts[a], verts[c + 1] - verts[a + 1], verts[c + 2] - verts[a + 2]]
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    volume += (ax * nx + ay * ny + az * nz) / 6
    area += Math.hypot(nx, ny, nz) / 2
  }
  return { volume, area }
}

const RAY = (() => {
  const d = [0.8016, 0.4913, 0.3409]
  const l = Math.hypot(d[0], d[1], d[2])
  return d.map((x) => x / l)
})()

/** 광선 방향으로 내려다본 평면에 삼각형을 격자로 나눠 두어, 점 하나의 광선이 지나는 칸만 검사합니다. */
type RayIndex = {
  shell: Mesh
  min: [number, number]
  cell: [number, number]
  size: number
  start: Int32Array
  items: Int32Array
}

// RAY × (0, 1, 0)
const RAY_U = (() => {
  const u = [-RAY[2], 0, RAY[0]]
  const l = Math.hypot(u[0], u[1], u[2])
  return u.map((x) => x / l)
})()
const RAY_V = cross(RAY, RAY_U)

function buildRayIndex(shell: Mesh): RayIndex {
  const { verts, tris } = shell
  const count = tris.length / 3
  const project = (axis: number[], v: number) => verts[v * 3] * axis[0] + verts[v * 3 + 1] * axis[1] + verts[v * 3 + 2] * axis[2]
  const lo = [Infinity, Infinity]
  const hi = [-Infinity, -Infinity]
  for (let v = 0; v < verts.length / 3; v++) {
    const pu = project(RAY_U, v)
    const pv = project(RAY_V, v)
    lo[0] = Math.min(lo[0], pu)
    lo[1] = Math.min(lo[1], pv)
    hi[0] = Math.max(hi[0], pu)
    hi[1] = Math.max(hi[1], pv)
  }
  const boxes = new Float64Array(count * 4)
  for (let t = 0; t < count; t++) {
    const u0 = project(RAY_U, tris[t * 3])
    const u1 = project(RAY_U, tris[t * 3 + 1])
    const u2 = project(RAY_U, tris[t * 3 + 2])
    const v0 = project(RAY_V, tris[t * 3])
    const v1 = project(RAY_V, tris[t * 3 + 1])
    const v2 = project(RAY_V, tris[t * 3 + 2])
    boxes[t * 4] = Math.min(u0, u1, u2)
    boxes[t * 4 + 1] = Math.max(u0, u1, u2)
    boxes[t * 4 + 2] = Math.min(v0, v1, v2)
    boxes[t * 4 + 3] = Math.max(v0, v1, v2)
  }
  // 원기둥 옆면 같은 길쭉한 삼각형은 경계 상자가 칸을 수백 개씩 덮어 항목 수가 폭증하므로,
  // 항목이 삼각형 수의 8배를 넘으면 격자를 반으로 성기게 합니다.
  let size = Math.max(1, Math.ceil(Math.sqrt(count)))
  let cell: [number, number] = [1, 1]
  const span = (t: number, k: number) => {
    const lo0 = Math.min(size - 1, Math.max(0, Math.floor((boxes[t * 4 + k * 2] - lo[k]) / cell[k])))
    const hi0 = Math.min(size - 1, Math.max(0, Math.floor((boxes[t * 4 + k * 2 + 1] - lo[k]) / cell[k])))
    return [lo0, hi0]
  }
  for (;;) {
    cell = [(hi[0] - lo[0]) / size || 1, (hi[1] - lo[1]) / size || 1]
    if (size === 1) break
    let total = 0
    for (let t = 0; t < count && total <= 8 * count; t++) {
      const [a0, a1] = span(t, 0)
      const [b0, b1] = span(t, 1)
      total += (a1 - a0 + 1) * (b1 - b0 + 1)
    }
    if (total <= 8 * count) break
    size = Math.max(1, size >> 1)
  }
  const sizes = new Int32Array(size * size)
  for (let t = 0; t < count; t++) {
    const [a0, a1] = span(t, 0)
    const [b0, b1] = span(t, 1)
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) sizes[a * size + b]++
  }
  const start = new Int32Array(size * size + 1)
  for (let c = 0; c < size * size; c++) start[c + 1] = start[c] + sizes[c]
  const fill = start.slice(0, -1)
  const items = new Int32Array(start[size * size])
  for (let t = 0; t < count; t++) {
    const [a0, a1] = span(t, 0)
    const [b0, b1] = span(t, 1)
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) items[fill[a * size + b]++] = t
  }
  return { shell, min: [lo[0], lo[1]], cell, size, start, items }
}

function rayParityInside(p: number[], index: RayIndex) {
  const { verts, tris } = index.shell
  const pu = p[0] * RAY_U[0] + p[1] * RAY_U[1] + p[2] * RAY_U[2]
  const pv = p[0] * RAY_V[0] + p[1] * RAY_V[1] + p[2] * RAY_V[2]
  // 색인을 만들 때처럼 위쪽 경계에 정확히 걸린 점은 마지막 칸으로 넣습니다.
  const a0 = Math.min(index.size - 1, Math.floor((pu - index.min[0]) / index.cell[0]))
  const b0 = Math.min(index.size - 1, Math.floor((pv - index.min[1]) / index.cell[1]))
  if (a0 < 0 || b0 < 0 || pu > index.min[0] + index.cell[0] * index.size || pv > index.min[1] + index.cell[1] * index.size) return false
  const c = a0 * index.size + b0
  const [dx, dy, dz] = RAY
  let hits = 0
  for (let i = index.start[c]; i < index.start[c + 1]; i++) {
    const t = index.items[i] * 3
    const a = tris[t] * 3
    const b = tris[t + 1] * 3
    const cc = tris[t + 2] * 3
    const e1x = verts[b] - verts[a]
    const e1y = verts[b + 1] - verts[a + 1]
    const e1z = verts[b + 2] - verts[a + 2]
    const e2x = verts[cc] - verts[a]
    const e2y = verts[cc + 1] - verts[a + 1]
    const e2z = verts[cc + 2] - verts[a + 2]
    const qx = dy * e2z - dz * e2y
    const qy = dz * e2x - dx * e2z
    const qz = dx * e2y - dy * e2x
    const det = e1x * qx + e1y * qy + e1z * qz
    if (Math.abs(det) < 1e-20) continue
    const sx = p[0] - verts[a]
    const sy = p[1] - verts[a + 1]
    const sz = p[2] - verts[a + 2]
    const u = (sx * qx + sy * qy + sz * qz) / det
    if (u < 0 || u > 1) continue
    const rx = sy * e1z - sz * e1y
    const ry = sz * e1x - sx * e1z
    const rz = sx * e1y - sy * e1x
    const v = (dx * rx + dy * ry + dz * rz) / det
    if (v < 0 || u + v > 1) continue
    if ((e2x * rx + e2y * ry + e2z * rz) / det > 0) hits++
  }
  return hits % 2 === 1
}

const NEST_SAMPLES = 16

function samplePoints({ verts, tris }: Mesh): number[][] {
  const count = tris.length / 3
  const picks = new Set<number>()
  for (let i = 0; i < NEST_SAMPLES; i++) picks.add(Math.floor((i * count) / NEST_SAMPLES))
  return [...picks].map((t) => centroid(verts, tris.subarray(t * 3, t * 3 + 3)))
}

/**
 * 닫힌 셸마다 다른 셸 안에 들어 있는지 따져 바로 바깥 셸을 parent에 적습니다.
 * 바깥 셸이 아직 열려 있을 수도 있어 열린 셸도 감싸는 쪽으로 따지고, 크기는 경계 상자로 비교합니다.
 */
function nest(shells: Shell[], scale: number) {
  const box = shells.map((s) => bounds(s.verts))
  const boxVolume = box.map(({ min, max }) => (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]))
  const eps = scale * 1e-6
  const indexes = new Map<number, RayIndex>()
  const indexOf = (o: number) => {
    let index = indexes.get(o)
    if (!index) indexes.set(o, (index = buildRayIndex(shells[o])))
    return index
  }
  // 감싸는 셸은 안쪽 셸 경계 상자의 중심을 반드시 품으므로, 셸 경계 상자를 균일 격자에 넣고
  // 중심이 든 칸의 셸만 견줍니다. 셸이 수만 개인 격자 구조물에서 모든 쌍을 비교하지 않기 위해서입니다.
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const { min, max } of box) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], min[k])
      hi[k] = Math.max(hi[k], max[k])
    }
  }
  const g = Math.min(32, Math.max(1, Math.ceil(Math.cbrt(shells.length))))
  const step = [0, 1, 2].map((k) => (hi[k] - lo[k]) / g || 1)
  const cellOf = (x: number, k: number) => Math.min(g - 1, Math.max(0, Math.floor((x - lo[k]) / step[k])))
  const cells: number[][] = Array.from({ length: g * g * g }, () => [])
  box.forEach(({ min, max }, o) => {
    for (let x = cellOf(min[0], 0); x <= cellOf(max[0], 0); x++) {
      for (let y = cellOf(min[1], 1); y <= cellOf(max[1], 1); y++) {
        for (let z = cellOf(min[2], 2); z <= cellOf(max[2], 2); z++) cells[(x * g + y) * g + z].push(o)
      }
    }
  })

  shells.forEach((inner, i) => {
    if (!inner.closed) return
    const b = box[i]
    const c = [0, 1, 2].map((k) => cellOf((b.min[k] + b.max[k]) / 2, k))
    let points: number[][] | null = null
    let parent = -1
    for (const o of cells[(c[0] * g + c[1]) * g + c[2]]) {
      if (o === i || boxVolume[o] <= boxVolume[i]) continue
      const a = box[o]
      if (
        a.min[0] > b.min[0] + eps ||
        a.min[1] > b.min[1] + eps ||
        a.min[2] > b.min[2] + eps ||
        b.max[0] > a.max[0] + eps ||
        b.max[1] > a.max[1] + eps ||
        b.max[2] > a.max[2] + eps
      )
        continue
      if (parent >= 0 && boxVolume[o] >= boxVolume[parent]) continue
      points ??= samplePoints(inner)
      // 광선이 공유 모서리를 정확히 지나면 두 번 세어 홀짝이 뒤집힐 수 있어, 표본 하나는 어긋나도 봐줍니다.
      const index = indexOf(o)
      const outside = points.filter((p) => !rayParityInside(p, index)).length
      if (outside > (points.length >= 4 ? 1 : 0)) continue
      parent = o
    }
    inner.parent = parent
  })
}

/** 넓이가 가장 긴 변 제곱의 100만분의 1 이하인 면. float32로 저장된 일직선 점은 외적이 정확히 0이 되지 않습니다. */
const isDegenerate = (verts: number[], tris: number[]) => {
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]
    const [x, y, z] = triNormal(verts, a, b, c)
    if (Math.hypot(x, y, z) <= 2e-6 * Math.max(dist2(verts, a, b), dist2(verts, b, c), dist2(verts, c, a))) return true
  }
  return false
}

/**
 * 좌표의 0.5~99.5% 분위수로 잰 경계 상자. 망가진 파일에 튄 꼭짓점이 하나만 있어도 실제 상자로 재면
 * 자동 허용 오차가 부풀어 모델 전체가 한 점으로 용접되므로, 자동 값의 기준으로는 이것을 씁니다.
 */
function robustBounds(positions: Float32Array) {
  // 넓이 없는 쓰레기 면이 한 점에 몰려 있으면 분위수가 그 점으로 쪼그라드므로, 넓이 있는 면의 꼭짓점만 셉니다.
  const count = positions.length / 9
  const real = (t: number) => {
    const o = t * 9
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2]
    const wx = positions[o + 6] - positions[o], wy = positions[o + 7] - positions[o + 1], wz = positions[o + 8] - positions[o + 2]
    return uy * wz - uz * wy !== 0 || uz * wx - ux * wz !== 0 || ux * wy - uy * wx !== 0
  }
  let realCount = 0
  for (let t = 0; t < count; t++) if (real(t)) realCount++
  const useAll = realCount === 0
  // 꼭짓점 10만 개 안팎만 표본으로 씁니다.
  const stride = Math.max(1, Math.floor((useAll ? count : realCount) / 33334))
  const axes: number[][] = [[], [], []]
  for (let t = 0, seen = 0; t < count; t++) {
    if (!useAll && !real(t)) continue
    if (seen++ % stride) continue
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) axes[k].push(positions[t * 9 + v * 3 + k])
  }
  const min = [0, 0, 0]
  const max = [0, 0, 0]
  axes.forEach((sample, k) => {
    if (sample.length === 0) return
    sample.sort((a, b) => a - b)
    // 양 끝에서 0.5%씩, 표본이 작아도 최소 하나는 잘라야 튄 꼭짓점 하나를 걸러 냅니다.
    // 삼각형 한두 개짜리처럼 아주 작으면 자르지 않습니다.
    const trim = sample.length >= 20 ? Math.max(1, Math.floor(0.005 * sample.length)) : 0
    min[k] = sample[trim]
    max[k] = sample[sample.length - 1 - trim]
  })
  return { min, max, diagonal: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) }
}

export function repair(positions: Float32Array, options: RepairOptions): RepairResult {
  const finite = filterTriangles(positions, (t) => {
    for (let k = 0; k < 9; k++) if (!Number.isFinite(positions[t * 9 + k])) return false
    return true
  })
  const robust = robustBounds(finite.positions)
  // 강건한 상자에서 대각선의 1만 배 넘게 떨어진 꼭짓점은 망가진 좌표로 보고 그 면을 처음에 한 번 걷어 냅니다.
  // 남겨 두면 공간 격자의 칸 번호가 부풀어 이후 단계가 끝나지 않을 수 있습니다. 분위수는 꼭짓점 수로 재므로,
  // 촘촘한 부품 옆의 성긴 긴 막대처럼 실제 형상이 상자 밖에 놓일 수 있어 여유를 크게 둡니다.
  const margin = robust.diagonal * 1e4
  const inRange = filterTriangles(finite.positions, (t) => {
    for (let k = 0; k < 9; k++) {
      const x = finite.positions[t * 9 + k]
      if (x < robust.min[k % 3] - margin || x > robust.max[k % 3] + margin) return false
    }
    return true
  })
  const scale = robust.diagonal || diagonal(bounds(inRange.positions))
  const tolerance = options.weldTolerance === 'auto' ? scale * 1e-6 : options.weldTolerance
  // 허용 오차가 0이어도 칸은 있어야 해서, 칸 크기는 대각선의 100만분의 1보다 작게 잡지 않습니다.
  const welded = weld(inRange.positions, tolerance, Math.max(tolerance, scale * 1e-6) || 1)
  const { tris, degenerate, duplicate, internal } = dedupe(welded.tris)
  // 지운 면만 쓰던 꼭짓점이 남으면 원본 꼭짓점 수와 미리보기 범위가 부풀므로 걷어 냅니다.
  const before: Mesh = compactVertices(welded.verts, tris)
  const { diagnosis: beforeDiagnosis, boundaryLines, nonManifoldLines, edges: beforeEdges } = diagnose(before)

  const stitchGap = options.stitchGap === 'auto' ? Math.min(scale * 2e-4, 0.05) : options.stitchGap
  const stitched = stitch(before.verts, before.tris, stitchGap, tolerance, beforeEdges)
  const mesh = { verts: stitched.verts, tris: stitched.tris }
  // 꿰맨 곳이 없으면 메시가 그대로라 원본 진단의 모서리 표를 다시 씁니다.
  const edges = mesh.tris === before.tris ? beforeEdges : buildEdges(mesh.tris, mesh.verts.length / 3)
  const { component, flip, components, conflicted } = orient(mesh.tris, edges)

  const members: number[][] = Array.from({ length: components }, () => [])
  for (let t = 0; t < component.length; t++) members[component[t]].push(t)

  const stats: RepairStats = {
    nonFinite: finite.dropped,
    outliers: inRange.dropped,
    weldTolerance: tolerance,
    rawVertices: inRange.positions.length / 3,
    weldedVertices: welded.verts.length / 3,
    degenerate: degenerate + stitched.stats.degenerate,
    duplicate: duplicate + stitched.stats.duplicate,
    internal: internal + stitched.stats.internal,
    stitchGap,
    stitched: stitched.stats.stitched,
    tJunctions: stitched.stats.tJunctions,
    pinches: 0,
    reversed: 0,
    nonOrientable: 0,
    holesFilled: 0,
    holesUnfilled: 0,
    fillTriangles: 0,
    fragmentsRemoved: 0,
    cavities: 0,
    nestedVoids: 0,
    openShells: 0,
  }

  const local = new Int32Array(mesh.verts.length / 3).fill(-1)
  const work: { holes: number; broken: number; pinches: number; conflicted: boolean; reversed: number; area: number }[] = []
  const shells: Shell[] = []
  const shellFlips: Uint8Array[] = []
  for (const [c, list] of members.entries()) {
    const verts: number[] = []
    const shellTris: number[] = []
    const used: number[] = []
    const flips = new Uint8Array(list.length)
    list.forEach((t, i) => {
      flips[i] = flip[t]
      const corners = flip[t] ? [0, 2, 1] : [0, 1, 2]
      for (const j of corners) {
        const v = mesh.tris[t * 3 + j]
        if (local[v] < 0) {
          local[v] = used.length
          used.push(v)
          verts.push(mesh.verts[v * 3], mesh.verts[v * 3 + 1], mesh.verts[v * 3 + 2])
        }
        shellTris.push(local[v])
      }
    })
    for (const v of used) local[v] = -1

    const filled: number[] = list.map(() => 0)
    // 방향이 꼬인 덩어리는 짝을 잘못 지어 틈을 낼 수 있어 건너뜁니다.
    // 모서리 표는 메시가 실제로 바뀐 때만 다시 만들어 이어지는 단계에서 함께 씁니다.
    let shellEdges = buildEdges(Uint32Array.from(shellTris), verts.length / 3)
    const pinches = conflicted[c] ? 0 : splitPinches(verts, shellTris, shellEdges)
    if (pinches > 0) shellEdges = buildEdges(Uint32Array.from(shellTris), verts.length / 3)
    const holes = options.fillHoles ? fillHoles(verts, shellTris, filled, shellEdges) : { holes: 0, broken: 0 }
    const vertsArr = Float32Array.from(verts)
    const trisArr = Uint32Array.from(shellTris)
    const closed = diagnose({ verts: vertsArr, tris: trisArr }, holes.holes > 0 ? undefined : shellEdges).diagnosis.closed
    // 열린 셸의 부호 있는 부피는 기준점에 따라 달라져서, 셸 자신의 무게중심을 기준으로 잽니다.
    const { volume, area } = signedVolume(verts, shellTris, centroid(verts))

    // 얇은 판도 부피/면적^1.5 비가 1e-4 안팎이라, 1e-6 아래는 사실상 두께가 없는 조각입니다.
    // 방향이 꼬인 셸은 앞뒤 면의 부피가 서로 상쇄되어 두꺼워도 0에 가깝게 나오므로 건너뜁니다.
    if (options.removeFragments && !conflicted[c] && Math.abs(volume) <= 1e-6 * area ** 1.5) {
      stats.fragmentsRemoved++
      continue
    }
    shells.push({ verts: vertsArr, tris: trisArr, filled: Uint8Array.from(filled), closed, volume, cavity: false, parent: -1 })
    shellFlips.push(flips)
    // 나중에 지워지는 셸(빈 공간 안의 빈 공간)의 작업이 내역에 섞이지 않게 셸마다 따로 모아 둡니다.
    work.push({ holes: holes.holes, broken: holes.broken, pinches, conflicted: conflicted[c], reversed: 0, area })
  }

  nest(shells, scale)
  // 원래 파일에서 각 셸이 어느 쪽을 향했는지(부피 부호)를 셉니다.
  const flippedMost = shellFlips.map((flips) => flips.reduce((sum, f) => sum + f, 0) * 2 > flips.length)
  const originalSign = shells.map((shell, i) => ((shell.volume < 0) !== flippedMost[i] ? -1 : 1))
  const rootOf = (i: number) => {
    while (shells[i].parent >= 0) i = shells[i].parent
    return i
  }
  shells.forEach((shell, i) => {
    const flips = shellFlips[i]
    // 안에 박힌 부품도 흔해서, 다른 셸 안에 있으면서 원래 방향이 맨 바깥 셸과 반대인 셸만 빈 공간으로 봅니다.
    // 맨 바깥 셸과 비교해야 법선이 통째로 뒤집혀 내보낸 파일에서도 안팎이 바뀌지 않습니다.
    // 맨 바깥 셸이 열려 있으면 무게중심 기준 부피의 부호를 쓰되, 판처럼 부피가 거의 없어 부호를 믿을 수
    // 없으면 자기 방향만 봅니다.
    const root = rootOf(i)
    const trusted = shells[root].closed || Math.abs(shells[root].volume) > 1e-3 * work[root].area ** 1.5
    const reference = root !== i && trusted ? originalSign[root] : 1
    const inward = shell.parent >= 0 && originalSign[i] !== reference
    shell.cavity = shell.closed && inward
    // 열린 셸은 부피로 안팎을 알 수 없어, 원래 파일에서 더 많은 면이 따르던 방향으로 둡니다.
    const wrong = shell.closed ? shell.volume < 0 !== inward : flippedMost[i]
    if (wrong) {
      for (let t = 0; t < shell.tris.length; t += 3) {
        const b = shell.tris[t + 1]
        shell.tris[t + 1] = shell.tris[t + 2]
        shell.tris[t + 2] = b
      }
      shell.volume = -shell.volume
    }
    for (let t = 0; t < flips.length; t++) if (flips[t] !== (wrong ? 1 : 0)) work[i].reversed++
  })

  // 빈 공간 안의 빈 공간은 이미 비어 있는 곳이라 뜻이 없고, 남겨 두면 뒤집힌 셸로 출력됩니다.
  const keep = shells.map((s) => !(s.cavity && shells[s.parent]?.cavity))
  const renumber = new Int32Array(shells.length).fill(-1)
  const kept: Shell[] = []
  shells.forEach((s, i) => {
    if (!keep[i]) return
    renumber[i] = kept.length
    kept.push(s)
  })
  for (const s of kept) if (s.parent >= 0) s.parent = renumber[s.parent]
  stats.nestedVoids = shells.length - kept.length
  shells.forEach((s, i) => {
    if (!keep[i]) return
    const w = work[i]
    stats.holesFilled += w.holes
    stats.holesUnfilled += w.broken
    stats.pinches += w.pinches
    stats.reversed += w.reversed
    stats.fillTriangles += s.filled.reduce((sum, f) => sum + f, 0)
    if (w.conflicted) stats.nonOrientable++
    if (s.cavity) stats.cavities++
    if (!s.closed) stats.openShells++
  })

  return { before, beforeDiagnosis, boundaryLines, nonManifoldLines, shells: kept, stats }
}
