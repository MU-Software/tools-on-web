import Module from 'manifold-3d'
import { errorMessage } from '../../lib/error'
import type { Manifold } from 'manifold-3d'
import type { Mesh, Shell } from './repair'

export type Merged = Mesh & {
  filled: Uint8Array
  /** manifold로 합친 덩어리 수. 빈 공간은 바깥 셸과 한 덩어리로 셉니다 */
  unioned: number
  /** manifold가 받아들이지 못해 그대로 이어 붙인 셸 수 */
  rejected: number
  /** manifold를 불러오거나 합집합을 구하지 못해 합치기를 건너뛴 이유 */
  unionError?: string
  /** 합치기를 꺼서 따로 둔 덩어리 수 */
  skipped: number
}

let wasm: ReturnType<typeof Module> | null = null

async function load() {
  // 워커를 계속 다시 쓰므로, 한 번 받기에 실패한 약속을 붙들고 있으면 새로고침 전까지 합치기가 막힙니다.
  wasm ??= Module()
    .then((m) => {
      m.setup()
      return m
    })
    .catch((e: unknown) => {
      wasm = null
      throw e
    })
  return wasm
}

function concat(parts: { verts: Float32Array; tris: Uint32Array; filled: Uint8Array }[]) {
  const verts = new Float32Array(parts.reduce((n, p) => n + p.verts.length, 0))
  const tris = new Uint32Array(parts.reduce((n, p) => n + p.tris.length, 0))
  const filled = new Uint8Array(tris.length / 3)
  let v = 0
  let t = 0
  for (const p of parts) {
    verts.set(p.verts, v)
    for (let i = 0; i < p.tris.length; i++) tris[t + i] = p.tris[i] + v / 3
    filled.set(p.filled, t / 3)
    v += p.verts.length
    t += p.tris.length
  }
  return { verts, tris, filled }
}

// 중단된 wasm 힙에서는 delete도 던질 수 있는데, 그 예외가 앞서 고른 반환값(수리 결과)을 덮지 않게 삼킵니다.
const release = (m: Manifold) => {
  try {
    m.delete()
  } catch {
    wasm = null
  }
}

/** 합치지 않고 셸을 그대로 이어 붙인 결과 */
const asIs = (shells: Shell[], info: Partial<Pick<Merged, 'rejected' | 'unionError' | 'skipped'>>): Merged => ({
  ...concat(shells),
  unioned: 0,
  rejected: 0,
  skipped: 0,
  ...info,
})

/** 바깥 셸과 그 안의 빈 공간을 한 덩어리로 묶어 manifold에 넘기고, 덩어리끼리 합집합을 구합니다. */
export async function unionShells(shells: Shell[], enabled: boolean): Promise<Merged> {
  const groups = new Map<number, number[]>()
  const leftovers: Shell[] = []
  shells.forEach((s, i) => {
    // 바깥 셸이 열려 있으면 빈 공간을 함께 묶어 넘길 수 없어 그대로 둡니다.
    if (!s.closed || (s.cavity && !shells[s.parent]?.closed)) {
      leftovers.push(s)
      return
    }
    const key = s.cavity ? s.parent : i
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  })
  if (!enabled || groups.size <= 1) {
    return asIs(shells, { skipped: enabled ? 0 : groups.size })
  }

  let toplevel: Awaited<ReturnType<typeof load>>
  try {
    toplevel = await load()
  } catch (e) {
    // wasm을 받지 못해도 앞 단계의 수리 결과는 살립니다.
    return asIs(shells, { unionError: `manifold를 불러오지 못했습니다: ${errorMessage(e)}` })
  }
  const { Manifold, Mesh: ManifoldMesh } = toplevel
  // 삼각형마다 고유한 faceID를 주면 단순화를 막고, 결과에서 메운 면을 되짚을 수 있습니다.
  // 바깥 셸만 다시 넘기는 경우에도 같은 번호를 쓰도록 셸마다 한 번만 매깁니다.
  const filledById: number[] = []
  const firstId = new Map<number, number>()
  const idsOf = (i: number) => {
    let first = firstId.get(i)
    if (first === undefined) {
      first = filledById.length
      firstId.set(i, first)
      for (const f of shells[i].filled) filledById.push(f)
    }
    return first
  }
  const solidOf = (members: number[]) => {
    const part = concat(members.map((i) => shells[i]))
    const faceID = new Uint32Array(part.filled.length)
    let at = 0
    for (const i of members) {
      const first = idsOf(i)
      for (let t = 0; t < shells[i].filled.length; t++) faceID[at++] = first + t
    }
    // 생성자는 상태가 NoError가 아니면 ManifoldError를 던집니다.
    try {
      const solid = new Manifold(new ManifoldMesh({ numProp: 3, vertProperties: part.verts, triVerts: part.tris, faceID }))
      if (!solid.isEmpty()) return solid
      solid.delete()
    } catch {
      // 받아들이지 못한 셸은 호출한 쪽에서 그대로 둡니다.
    }
    return null
  }

  const accepted: Manifold[] = []
  let rejected = 0
  try {
    for (const members of groups.values()) {
      let solid = solidOf(members)
      let kept = members
      if (!solid && members.length > 1) {
        // 포함 판정이 빗나가 빈 공간이 바깥 셸과 겹치면 거부되므로, 바깥 셸만 다시 시도합니다.
        kept = members.filter((i) => !shells[i].cavity)
        solid = solidOf(kept)
      }
      if (!solid) kept = []
      else accepted.push(solid)
      for (const i of members) {
        if (kept.includes(i)) continue
        leftovers.push(shells[i])
        rejected++
      }
    }
    if (accepted.length === 0) return asIs(shells, { rejected })

    let result: Manifold
    try {
      result = accepted.length === 1 ? accepted[0] : Manifold.union(accepted)
    } catch (e) {
      // 합집합이 실패해도(메모리 부족 등) 앞 단계의 수리 결과는 살려서 셸을 그대로 이어 붙입니다.
      // wasm이 중단되면 모듈이 망가진 채 남으므로, 다음 작업에서 새로 불러오게 캐시를 비웁니다.
      wasm = null
      return asIs(shells, { rejected, unionError: `합집합을 구하지 못했습니다: ${errorMessage(e)}` })
    }
    try {
      const out = result.getMesh()
      const verts = new Float32Array(out.numVert * 3)
      for (let v = 0; v < out.numVert; v++) {
        for (let k = 0; k < 3; k++) verts[v * 3 + k] = out.vertProperties[v * out.numProp + k]
      }
      const filled = new Uint8Array(out.numTri)
      for (let i = 0; i < filled.length; i++) filled[i] = filledById[out.faceID[i]] ?? 0
      const solidPart = { verts, tris: out.triVerts.slice(), filled }
      return { ...concat([solidPart, ...leftovers]), unioned: accepted.length, rejected, skipped: 0 }
    } catch (e) {
      wasm = null
      return asIs(shells, { rejected, unionError: `합집합 결과를 읽지 못했습니다: ${errorMessage(e)}` })
    } finally {
      if (!accepted.includes(result)) release(result)
    }
  } finally {
    accepted.forEach(release)
  }
}
