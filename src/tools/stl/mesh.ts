export function sort3(a: number, b: number, c: number): [number, number, number] {
  if (a > b) [a, b] = [b, a]
  if (b > c) [b, c] = [c, b]
  if (a > b) [a, b] = [b, a]
  return [a, b, c]
}

export const mix = (a: number, b: number, c: number) =>
  (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) | 0

/**
 * 같은 세 꼭짓점의 면을 묶어 감김 방향별로 셉니다. 반대 방향끼리는 맞붙은 물체 사이의 벽이라
 * 짝지어 지우고, 남는 쪽 방향으로 하나만 둡니다(libigl resolve_duplicated_faces와 같은 규칙).
 */
export function dedupe(tris: Uint32Array) {
  const firstOf: number[] = []
  const forward: number[] = []
  const backward: number[] = []
  const heads = new Map<number, number>()
  const next: number[] = []
  let degenerate = 0

  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = sort3(tris[t], tris[t + 1], tris[t + 2])
    if (a === b || b === c) {
      degenerate++
      continue
    }
    const h = mix(a, b, c)
    let group = -1
    for (let g = heads.get(h) ?? -1; g >= 0 && group < 0; g = next[g]) {
      const f = firstOf[g]
      const s = sort3(tris[f], tris[f + 1], tris[f + 2])
      if (s[0] === a && s[1] === b && s[2] === c) group = g
    }
    if (group < 0) {
      group = firstOf.length
      firstOf.push(t)
      forward.push(1)
      backward.push(0)
      next.push(heads.get(h) ?? -1)
      heads.set(h, group)
      continue
    }
    const f = firstOf[group]
    const i = tris[f] === tris[t] ? 0 : tris[f + 1] === tris[t] ? 1 : 2
    if (tris[f + ((i + 1) % 3)] === tris[t + 1]) forward[group]++
    else backward[group]++
  }

  const out: number[] = []
  let duplicate = 0
  let internal = 0
  firstOf.forEach((f, g) => {
    const net = forward[g] - backward[g]
    internal += 2 * Math.min(forward[g], backward[g])
    duplicate += Math.max(0, Math.abs(net) - 1)
    if (net > 0) out.push(tris[f], tris[f + 1], tris[f + 2])
    else if (net < 0) out.push(tris[f], tris[f + 2], tris[f + 1])
  })
  return { tris: Uint32Array.from(out), degenerate, duplicate, internal }
}

export type Edges = {
  /** 반모서리(삼각형 t의 i번째 변 = t*3+i)마다 모서리 번호 */
  edgeOf: Int32Array
  start: Int32Array
  halves: Int32Array
  count: number
}

export const nextHalf = (h: number) => (h % 3 === 2 ? h - 2 : h + 1)

export function buildEdges(tris: Uint32Array, vertexCount: number): Edges {
  const ids = new Map<number, number>()
  const edgeOf = new Int32Array(tris.length)
  const sizes: number[] = []
  for (let h = 0; h < tris.length; h++) {
    const u = tris[h]
    const v = tris[nextHalf(h)]
    const key = Math.min(u, v) * vertexCount + Math.max(u, v)
    let e = ids.get(key)
    if (e === undefined) {
      e = sizes.length
      ids.set(key, e)
      sizes.push(0)
    }
    sizes[e]++
    edgeOf[h] = e
  }
  const start = new Int32Array(sizes.length + 1)
  for (let e = 0; e < sizes.length; e++) start[e + 1] = start[e] + sizes[e]
  const fill = start.slice(0, -1)
  const halves = new Int32Array(tris.length)
  for (let h = 0; h < tris.length; h++) halves[fill[edgeOf[h]]++] = h
  return { edgeOf, start, halves, count: sizes.length }
}

export const edgeSize = (edges: Edges, e: number) => edges.start[e + 1] - edges.start[e]

export const cross = (u: ArrayLike<number>, w: ArrayLike<number>): [number, number, number] => [
  u[1] * w[2] - u[2] * w[1],
  u[2] * w[0] - u[0] * w[2],
  u[0] * w[1] - u[1] * w[0],
]

export function triNormal(verts: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const u = [0, 1, 2].map((k) => verts[b * 3 + k] - verts[a * 3 + k])
  const w = [0, 1, 2].map((k) => verts[c * 3 + k] - verts[a * 3 + k])
  return cross(u, w)
}

export function unitNormal(verts: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const [x, y, z] = triNormal(verts, a, b, c)
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}

export function disjointSet(size: number) {
  const parent = Int32Array.from({ length: size }, (_, i) => i)
  const root = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]]
    return x
  }
  return { parent, root }
}

export type Grid = { size: number; heads: Map<number, number>; next: number[]; items: number[] }

export function makeGrid(size: number): Grid {
  return { size, heads: new Map(), next: [], items: [] }
}

export function gridAdd(grid: Grid, x: number, y: number, z: number, item: number) {
  const key = mix(Math.floor(x / grid.size), Math.floor(y / grid.size), Math.floor(z / grid.size))
  grid.next.push(grid.heads.get(key) ?? -1)
  grid.heads.set(key, grid.items.length)
  grid.items.push(item)
}

/** 상자와 겹치는 칸의 항목을 돌며, visit이 true를 돌려주면 멈춥니다. 칸 키가 겹칠 수 있어 거리는 호출한 쪽이 다시 잽니다. */
export function gridQuery(grid: Grid, min: number[], max: number[], visit: (item: number) => boolean | void) {
  const lo = min.map((v) => Math.floor(v / grid.size))
  const hi = max.map((v) => Math.floor(v / grid.size))
  // 칸 번호가 2^53을 넘으면 x++가 값을 바꾸지 못해 끝나지 않으므로 그런 상자는 건너뜁니다.
  if (![...lo, ...hi].every(Number.isSafeInteger)) return
  for (let x = lo[0]; x <= hi[0]; x++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let z = lo[2]; z <= hi[2]; z++) {
        for (let i = grid.heads.get(mix(x, y, z)) ?? -1; i >= 0; i = grid.next[i]) if (visit(grid.items[i])) return
      }
    }
  }
}

export function dist2(verts: ArrayLike<number>, a: number, b: number) {
  const dx = verts[a * 3] - verts[b * 3]
  const dy = verts[a * 3 + 1] - verts[b * 3 + 1]
  const dz = verts[a * 3 + 2] - verts[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

/** indices의 꼭짓점 평균. indices를 빼면 모든 꼭짓점의 평균입니다. */
export function centroid(verts: ArrayLike<number>, indices?: ArrayLike<number>): [number, number, number] {
  const count = indices ? indices.length : verts.length / 3
  const c: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    const v = indices ? indices[i] : i
    c[0] += verts[v * 3]
    c[1] += verts[v * 3 + 1]
    c[2] += verts[v * 3 + 2]
  }
  if (count > 0) for (let k = 0; k < 3; k++) c[k] /= count
  return c
}

/** 어느 면도 쓰지 않는 꼭짓점을 걷어 냅니다. 모두 쓰이면 받은 배열을 그대로 돌려줍니다. */
export function compactVertices(verts: Float32Array, tris: Uint32Array) {
  const count = verts.length / 3
  const remap = new Int32Array(count).fill(-1)
  for (const v of tris) remap[v] = 0
  let kept = 0
  for (let v = 0; v < count; v++) if (remap[v] === 0) remap[v] = kept++
  if (kept === count) return { verts, tris }
  const packed = new Float32Array(kept * 3)
  for (let v = 0; v < count; v++) if (remap[v] >= 0) packed.set(verts.subarray(v * 3, v * 3 + 3), remap[v] * 3)
  return { verts: packed, tris: tris.map((v) => remap[v]) }
}
