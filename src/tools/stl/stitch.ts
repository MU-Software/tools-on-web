import { buildEdges, compactVertices, dedupe, disjointSet, dist2, edgeSize, gridAdd, gridQuery, makeGrid, nextHalf, unitNormal, type Edges } from './mesh'

export type StitchStats = {
  stitched: number
  tJunctions: number
  degenerate: number
  duplicate: number
  internal: number
}

function shortestEdges(verts: Float32Array, tris: Uint32Array) {
  const shortest = new Float64Array(verts.length / 3).fill(Infinity)
  for (let h = 0; h < tris.length; h++) {
    const a = tris[h]
    const b = tris[nextHalf(h)]
    const d = dist2(verts, a, b)
    if (d < shortest[a]) shortest[a] = d
    if (d < shortest[b]) shortest[b] = d
  }
  // 제곱 거리로 비교하므로 0.9²를 곱해 둡니다.
  return shortest.map((d) => d * 0.81)
}

function boundaryHalves(tris: Uint32Array, vertexCount: number, known?: Edges) {
  const edges = known ?? buildEdges(tris, vertexCount)
  const halves: number[] = []
  for (let e = 0; e < edges.count; e++) if (edgeSize(edges, e) === 1) halves.push(edges.halves[edges.start[e]])
  return halves
}

type Boundary = { halves: number[]; shortest: Float64Array }

function boundaryOf(verts: Float32Array, tris: Uint32Array, known?: Edges): Boundary {
  return { halves: boundaryHalves(tris, verts.length / 3, known), shortest: shortestEdges(verts, tris) }
}

/**
 * 양 끝점이 모두 tol 안에 드는 열린 모서리끼리 가까운 쌍부터 하나씩 짝지어 꼭짓점을 합칩니다.
 * 전역 용접과 달리 열린 모서리만 움직여서 얇은 벽이 무너지지 않습니다.
 */
function pairBoundaries(verts: Float32Array, tris: Uint32Array, tol: number, { halves, shortest }: Boundary) {
  if (halves.length < 2) return { tris, merged: 0 }

  const grid = makeGrid(tol)
  for (const h of halves) {
    const s = tris[h]
    gridAdd(grid, verts[s * 3], verts[s * 3 + 1], verts[s * 3 + 2], h)
  }
  const tol2 = tol * tol
  const corners = (h: number) => {
    const t = h - (h % 3)
    return [tris[t], tris[t + 1], tris[t + 2]]
  }
  const candidates: { h: number; g: number; score: number; pairs: [number, number][] }[] = []
  for (const h of halves) {
    const u = tris[h]
    const v = tris[nextHalf(h)]
    const own = corners(h)
    const n1 = unitNormal(verts, own[0], own[1], own[2])
    // 이웃이 반대로 감겨 있으면 같은 방향의 모서리와 마주하므로 두 방향 모두 찾습니다.
    for (const [near, far, opposite] of [
      [v, u, 1],
      [u, v, 0],
    ]) {
      const p = [verts[near * 3], verts[near * 3 + 1], verts[near * 3 + 2]]
      gridQuery(
        grid,
        p.map((x) => x - tol),
        p.map((x) => x + tol),
        (g) => {
          if (g <= h || g - (g % 3) === h - (h % 3)) return
          const s = tris[g]
          const e = tris[nextHalf(g)]
          const d1 = dist2(verts, near, s)
          const d2 = dist2(verts, far, e)
          // 짧은 모서리보다 멀리 끌어당기면 작은 형상이 뭉개집니다.
          const lim1 = Math.min(tol2, shortest[near], shortest[s])
          const lim2 = Math.min(tol2, shortest[far], shortest[e])
          if ((d1 > lim1 && near !== s) || (d2 > lim2 && far !== e)) return
          // 얇은 벽은 양쪽 면이 거의 정확히 등을 맞댑니다. 기준을 느슨하게 잡으면
          // 날카로운 모서리(쐐기·칼날)에 난 이음매까지 꿰매지 못합니다.
          const other = corners(g)
          const n2 = unitNormal(verts, other[0], other[1], other[2])
          const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
          if (opposite ? dot < -0.95 : dot > 0.95) return
          const pairs: [number, number][] = [
            [near, s],
            [far, e],
          ]
          // 같은 삼각형의 두 꼭짓점이 합쳐지면 그 면이 사라집니다.
          const collapses = pairs.some(
            ([a, b]) => a !== b && (own.includes(b) || other.includes(a)),
          )
          if (!collapses) candidates.push({ h, g, score: Math.max(d1, d2), pairs })
        },
      )
    }
  }
  if (candidates.length === 0) return { tris, merged: 0 }
  candidates.sort((a, b) => a.score - b.score)

  const degree = new Uint32Array(verts.length / 3)
  for (const v of tris) degree[v]++
  const { parent, root } = disjointSet(verts.length / 3)
  const used = new Set<number>()
  // 한 라운드에서 한 꼭짓점이 서로 다른 짝과 합쳐지면 같은 삼각형의 두 꼭짓점이 한 점으로 모일 수 있습니다.
  // 이미 같은 짝으로 합친 경우(이음매를 따라 이어지는 모서리)만 허용하고, 나머지는 다음 라운드로 미룹니다.
  const moved = new Set<number>()
  let merged = 0
  for (const { h, g, pairs } of candidates) {
    if (used.has(h) || used.has(g)) continue
    if (pairs.some(([a, b]) => root(a) !== root(b) && (moved.has(a) || moved.has(b)))) continue
    used.add(h).add(g)
    for (const [a, b] of pairs) moved.add(a).add(b)
    merged++
    for (const [a, b] of pairs) {
      const ra = root(a)
      const rb = root(b)
      if (ra === rb) continue
      // 면이 더 많이 붙은 꼭짓점을 남겨 이미 닫힌 쪽 모양을 지킵니다.
      if (degree[ra] >= degree[rb]) {
        parent[rb] = ra
        degree[ra] += degree[rb]
      } else {
        parent[ra] = rb
        degree[rb] += degree[ra]
      }
    }
  }
  return { tris: tris.map(root), merged }
}

/** 열린 모서리 중간에 걸친 다른 열린 꼭짓점에서 그 면을 쪼개, 양쪽 모서리 꼭짓점을 맞춥니다. */
function splitTJunctions(verts: Float32Array, tris: Uint32Array, tol: number, { halves, shortest }: Boundary) {
  if (halves.length < 2) return { tris, split: 0 }

  // 평균을 쓰면 긴 열린 모서리 몇 개에 칸이 커져 거의 모든 꼭짓점이 한 칸에 몰리므로 중앙값을 씁니다.
  const lengths = halves.map((h) => dist2(verts, tris[h], tris[nextHalf(h)])).sort((a, b) => a - b)
  const median = Math.sqrt(lengths[lengths.length >> 1])
  // 칸 크기를 tol의 두 배 이상으로 잡아야, 칸 절반 간격으로 찍은 점의 이웃 칸만 봐도 tol 안을 모두 덮습니다.
  const grid = makeGrid(Math.max(2 * tol, median))
  const onBoundary = new Set<number>()
  for (const h of halves) {
    for (const v of [tris[h], tris[nextHalf(h)]]) {
      if (onBoundary.has(v)) continue
      onBoundary.add(v)
      gridAdd(grid, verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2], v)
    }
  }

  const tol2 = tol * tol
  const touched = new Set<number>()
  const replaced = new Map<number, number[]>()
  let split = 0
  for (const h of halves) {
    const t = (h / 3) | 0
    if (touched.has(t)) continue
    const u = tris[h]
    const v = tris[nextHalf(h)]
    const w = tris[nextHalf(nextHalf(h))]
    const a = [verts[u * 3], verts[u * 3 + 1], verts[u * 3 + 2]]
    const d = [verts[v * 3] - a[0], verts[v * 3 + 1] - a[1], verts[v * 3 + 2] - a[2]]
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    if (len2 <= tol2) continue
    const hits: { s: number; p: number }[] = []
    const seen = new Set<number>()
    // 긴 모서리의 경계 상자를 통째로 훑으면 칸 수가 세제곱으로 늘어서, 모서리를 따라 걸으며 주변 칸만 봅니다.
    const steps = Math.ceil(Math.sqrt(len2) / (grid.size / 2))
    // 칸(중앙값 열린 모서리)의 5만 배가 넘는 모서리는 튄 면이라 T자 이음일 리 없고, 걷기만 수천만 걸음이 들어 건너뜁니다.
    if (steps > 100000) continue
    for (let i = 0; i <= steps; i++) {
      const c = [0, 1, 2].map((k) => a[k] + (d[k] * i) / steps)
      gridQuery(
        grid,
        c.map((x) => x - grid.size),
        c.map((x) => x + grid.size),
        (p) => {
          if (p === u || p === v || p === w || seen.has(p)) return
          seen.add(p)
          const q = [verts[p * 3] - a[0], verts[p * 3 + 1] - a[1], verts[p * 3 + 2] - a[2]]
          const s = (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / len2
          if (s * s * len2 <= tol2 || (1 - s) * (1 - s) * len2 <= tol2 || s <= 0 || s >= 1) return
          const off = [q[0] - s * d[0], q[1] - s * d[1], q[2] - s * d[2]]
          const off2 = off[0] * off[0] + off[1] * off[1] + off[2] * off[2]
          if (off2 <= tol2 && off2 <= shortest[p]) hits.push({ s, p })
        },
      )
    }
    if (hits.length === 0) continue
    hits.sort((x, y) => x.s - y.s)
    const chain = [u, ...hits.map((x) => x.p), v]
    const fan: number[] = []
    for (let i = 0; i + 1 < chain.length; i++) fan.push(chain[i], chain[i + 1], w)
    replaced.set(t, fan)
    touched.add(t)
    split += hits.length
  }
  if (split === 0) return { tris, split }

  const out: number[] = []
  for (let t = 0; t < tris.length / 3; t++) {
    const fan = replaced.get(t)
    if (fan) out.push(...fan)
    else out.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2])
  }
  return { tris: Uint32Array.from(out), split }
}

/**
 * 허용 오차를 작은 값부터 키워 가며 열린 모서리를 꿰매고, 끝나면 쓰이지 않는 꼭짓점을 걷어 냅니다.
 * 꼭짓점끼리 짝짓기를 모든 단계에서 먼저 끝낸 뒤 T자 이음을 나눕니다. 작은 단계에서 먼저 나누면
 * 조금 어긋난 같은 꼭짓점을 모서리 중간의 점으로 보고 면을 쪼개 버려, 큰 단계에서 짝을 찾지 못합니다.
 */
export function stitch(verts: Float32Array, input: Uint32Array, maxGap: number, minGap: number, edges?: Edges) {
  const stats: StitchStats = { stitched: 0, tJunctions: 0, degenerate: 0, duplicate: 0, internal: 0 }
  let tris = input
  const ladder = maxGap > 0 ? [maxGap / 16, maxGap / 4, maxGap] : []
  // 용접 허용 오차 안의 꼭짓점은 이미 합쳐졌으니 짝짓기는 그보다 큰 단계만 돕니다. T자 이음은 용접과 무관합니다.
  const pairLadder = ladder.filter((t) => t > minGap)
  if (ladder.length === 0) return { verts, tris, stats }
  // 모서리 표를 다시 만드는 비용이 커서, 메시가 실제로 바뀐 때만 새로 셉니다.
  let boundary = boundaryOf(verts, tris, edges)
  const commit = (next: Uint32Array) => {
    const clean = dedupe(next)
    tris = clean.tris
    boundary = boundaryOf(verts, tris)
    stats.degenerate += clean.degenerate
    stats.duplicate += clean.duplicate
    stats.internal += clean.internal
  }
  const pairAll = (tol: number) => {
    for (let round = 0; round < 4 && boundary.halves.length >= 2; round++) {
      const paired = pairBoundaries(verts, tris, tol, boundary)
      if (paired.merged === 0) return
      stats.stitched += paired.merged
      commit(paired.tris)
    }
  }
  for (const tol of pairLadder) pairAll(tol)
  for (const tol of ladder) {
    for (let round = 0; round < 4 && boundary.halves.length >= 2; round++) {
      const splitted = splitTJunctions(verts, tris, tol, boundary)
      if (splitted.split === 0) break
      stats.tJunctions += splitted.split
      commit(splitted.tris)
      if (tol > minGap) pairAll(tol)
    }
  }
  return { ...compactVertices(verts, tris), stats }
}
