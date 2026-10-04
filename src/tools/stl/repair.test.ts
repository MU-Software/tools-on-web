import { describe, expect, it } from 'vitest'
import { repair, signedVolume } from './repair'
import { unionShells } from './union'
import { AUTO, cube, cylinderCaps, cylinderSide, flip, prismVolume, run, soup, voxels, type Tris } from './fixtures'

describe('기본 수리', () => {
  it('멀쩡한 정육면체는 그대로', async () => {
    const r = await run(cube())
    expect(r.diagnosis.closed).toBe(true)
    expect(r.diagnosis.triangles).toBe(12)
    expect(r.volume).toBeCloseTo(1, 6)
  })

  it.each([true, false])('구멍·뒤집힌 면·미세 오차를 고친다 (합치기 %s)', async (union) => {
    const t = cube().slice(2).map((tri, i) => (i === 3 ? flip(tri) : tri))
    t[5] = t[5].map((x, k) => (k === 0 && x === 1 ? 1 + 1e-7 : x))
    const r = await run(t, {}, union)
    expect(r.diagnosis.closed).toBe(true)
    expect(r.diagnosis.triangles).toBe(12)
    expect(r.volume).toBeCloseTo(1, 4)
  })

  it('통째로 뒤집힌 정육면체를 바로잡는다', async () => {
    const r = await run(cube().map(flip))
    expect(r.volume).toBeCloseTo(1, 6)
    expect(r.stats.reversed).toBe(12)
  })

  it('면 두 개가 빠진 L자 구멍을 메운다', async () => {
    const r = await run(cube().filter((_, i) => i > 3))
    expect(r.diagnosis.closed).toBe(true)
  })

  it('겹친 정육면체를 합친다', async () => {
    const r = await run([...cube(), ...cube([0.5, 0.5, 0.5])])
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(1.875, 4)
  })

  it('떠도는 삼각형 하나는 조각으로 지운다', async () => {
    const r = await run([...cube(), [5, 5, 5, 6, 5, 5, 5, 6, 5]])
    expect(r.diagnosis.triangles).toBe(12)
    expect(r.stats.fragmentsRemoved).toBe(1)
  })

  it('모서리만 맞닿은 두 정육면체', async () => {
    const r = await run([...cube(), ...cube([1, 1, 0])])
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(2, 6)
  })

  it('같은 방향 중복은 하나만, 반대 방향 쌍은 둘 다 지운다', async () => {
    const r = await run([...cube(), ...cube().slice(0, 4), flip(cube()[5])])
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(1, 6)
  })

  it('같은 면 세 장(+,+,-)은 방향 개수 차이만큼 하나 남긴다', async () => {
    const r = await run([...cube(), cube()[0], flip(cube()[0])])
    expect(r.diagnosis.triangles).toBe(12)
    expect(r.filled).toBe(0)
  })

  it.each([true, false])('모서리에서 자기 자신과 맞닿은 덩어리를 떼어 낸다 (합치기 %s)', async (union) => {
    const r = await run(voxels([[0, 0, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1]]), {}, union)
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(5, 6)
  })

  it('꼭짓점에서 자기 자신과 맞닿은 덩어리', async () => {
    const r = await run(voxels([[0, 0, 0], [1, 1, 1], [1, 0, 0], [1, 0, 1]]))
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(4, 6)
  })

  it('manifold가 거부하는 셸이 있어도 던지지 않고 그대로 둔다', async () => {
    const good = repair(soup(cube()), AUTO).shells[0]
    const bad = { verts: Float32Array.from([0, 0, 5, 1, 0, 5, 0, 1, 5]), tris: Uint32Array.from([0, 1, 2]), filled: new Uint8Array(1), closed: true, volume: 1, cavity: false, parent: -1 }
    const m = await unionShells([good, bad], true)
    expect(m.rejected).toBe(1)
    expect(m.unioned).toBe(1)
    expect(m.tris.length / 3).toBe(13)
  })

  it('합치기를 끄면 따로 둔 덩어리 수를 알린다', async () => {
    const repaired = repair(soup([...cube(), ...cube([0.5, 0.5, 0.5])]), AUTO)
    const m = await unionShells(repaired.shells, false)
    expect(m.skipped).toBe(2)
  })
})

describe('틈 꿰매기와 T자 이음', () => {
  const crack = cube().map((t) => t.map((x, k) => (k % 3 === 2 && t[2] === 1 && t[5] === 1 && t[8] === 1 ? 1.003 : x)))

  it('0.003 벌어진 이음매를 메우지 않고 꿰맨다', async () => {
    const r = await run(crack, { stitchGap: 0.01 })
    expect(r.diagnosis.closed).toBe(true)
    expect(r.diagnosis.triangles).toBe(12)
    expect(r.filled).toBe(0)
  })

  it('꿰매기를 끄면 메운다', async () => {
    const r = await run(crack, { stitchGap: 0 })
    expect(r.diagnosis.closed).toBe(true)
    expect(r.filled).toBe(2)
  })

  const tJunction = (): Tris => {
    const m = [0.5, 0, 0]
    return [...cube().slice(1), [0, 0, 0, 1, 1, 0, ...m], [...m, 1, 1, 0, 1, 0, 0]]
  }

  it('T자 이음을 면을 나눠 맞춘다', async () => {
    const r = await run(tJunction(), { stitchGap: 0.01 })
    expect(r.diagnosis.closed).toBe(true)
    expect(r.filled).toBe(0)
    expect(r.volume).toBeCloseTo(1, 6)
  })

  it('용접 허용 오차가 꿰매기 거리보다 커도 T자 이음은 나눈다', async () => {
    const r = await run(tJunction(), { weldTolerance: 0.1 })
    expect(r.stats.tJunctions).toBe(1)
    expect(r.diagnosis.closed).toBe(true)
  })

  it('얇은 벽은 꿰매지 않는다', async () => {
    const a = [[0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 0, 0, 1, 1, 0, 0, 1, 0]]
    const b = [[0, 0, 0.005, 1, 1, 0.005, 1, 0, 0.005], [0, 0, 0.005, 0, 1, 0.005, 1, 1, 0.005]]
    const r = await run([...a, ...b], { stitchGap: 0.01, removeFragments: false, fillHoles: false })
    expect(r.stats.stitched).toBe(0)
  })

  it('꼭지각 30°의 쐐기 모서리 이음매도 꿰맨다', async () => {
    const h = Math.tan(Math.PI / 12) * 10
    const P = [[0, 0], [10, -h], [10, h]]
    const v = (i: number, z: number, dx = 0) => [P[i][0] + dx, P[i][1], z]
    const t = [
      [...v(0, 0), ...v(2, 0), ...v(1, 0)], [...v(0, 1), ...v(1, 1), ...v(2, 1)],
      [...v(0, 0), ...v(1, 0), ...v(1, 1)], [...v(0, 0), ...v(1, 1), ...v(0, 1)],
      [...v(1, 0), ...v(2, 0), ...v(2, 1)], [...v(1, 0), ...v(2, 1), ...v(1, 1)],
      [...v(2, 0), ...v(0, 0, 0.003), ...v(0, 1, 0.003)], [...v(2, 0), ...v(0, 1, 0.003), ...v(2, 1)],
    ]
    const r = await run(t, { stitchGap: 0.01 })
    expect(r.stats.stitched).toBeGreaterThan(0)
    expect(r.stats.fillTriangles).toBe(0)
    expect(r.diagnosis.closed).toBe(true)
  })

  it('튄 좌표 기준 안쪽에 있는 아주 긴 면이 있어도 T자 이음 탐색이 멈추지 않는다', () => {
    const t: Tris = []
    for (let i = 0; i < 4000; i++) t.push([i * 0.05, 0, 0, (i + 1) * 0.05, 0, 0, i * 0.05, 0.05, 0])
    t.push([0, 10, 0, 1e6, 0, 0, 0, 20, 0])
    const started = performance.now()
    const r = repair(soup(t), { ...AUTO, stitchGap: 0.01, fillHoles: false })
    expect(r.stats.outliers).toBe(0)
    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('잘게 나뉜 테두리 옆에 아주 긴 열린 모서리가 있어도 빨리 끝난다', () => {
    const t: Tris = []
    for (let i = 0; i < 4000; i++) t.push([i * 0.05, 0, 0, (i + 1) * 0.05, 0, 0, i * 0.05, 0.05, 0])
    t.push([0, 10, 0, 200, 200, 200, 0, 200, 0])
    const started = performance.now()
    repair(soup(t), { ...AUTO, stitchGap: 0.01, fillHoles: false })
    expect(performance.now() - started).toBeLessThan(3000)
  })
})

describe('구멍 메우기', () => {
  it('뚜껑이 빠진 원기둥(평평한 64각형 구멍)', async () => {
    const t = [...cylinderSide(64, [0, 1]), ...cylinderCaps(64, 0, 1).filter((_, i) => i % 2 === 0)]
    const r = await run(t)
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(prismVolume(64, 1), 4)
  })

  it('원기둥 옆면의 굽은 창은 Liepa로 원래 곡면을 되살린다', async () => {
    const rows = [0, 0.5, 1, 1.5, 2]
    const t = [...cylinderSide(64, rows, (i, r) => i < 8 && (r === 1 || r === 2)), ...cylinderCaps(64, 0, 2)]
    const r = await run(t)
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(prismVolume(64, 2), 4)
  })

  it('테두리를 가로질러 꺾인 구멍도 크게 부풀거나 꺼지지 않는다', async () => {
    const n = 64
    const q = (k: number) => [0.5 * Math.cos((2 * Math.PI * k) / n), 0.5 * Math.sin((2 * Math.PI * k) / n), 2]
    const p = (i: number) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n), 2]
    const t: Tris = cylinderSide(n, [0, 0.5, 1, 1.5, 2], (i, r) => i < 8 && r === 3)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      t.push([0, 0, 0, ...p(j).slice(0, 2), 0, ...p(i).slice(0, 2), 0], [0, 0, 2, ...q(i), ...q(j)])
      if (i >= 8) t.push([...p(i), ...p(j), ...q(j)], [...p(i), ...q(j), ...q(i)])
    }
    const r = await run(t)
    const err = prismVolume(n, 2) - r.volume
    expect(r.diagnosis.closed).toBe(true)
    expect(err).toBeGreaterThanOrEqual(0)
    expect(err).toBeLessThan(0.05)
  })

  it('둘레에 일직선 꼭짓점이 있어도 넓이 0인 면을 만들지 않는다', async () => {
    const c = cube()
    const m = [1, 0.5, 1]
    const split = [[1, 0, 0, 1, 1, 0, ...m], [1, 1, 0, 1, 1, 1, ...m], [1, 0, 0, ...m, 1, 0, 1]]
    const r = await run([...c.slice(0, 2), ...c.slice(4, 6), ...c.slice(8), ...split], { stitchGap: 0 }, false)
    const { verts, tris } = r.merged
    let minArea = Infinity
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, d] = [0, 1, 2].map((j) => [0, 1, 2].map((k) => verts[tris[t + j] * 3 + k]))
      const u = b.map((x, k) => x - a[k])
      const w = d.map((x, k) => x - a[k])
      minArea = Math.min(minArea, Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2)
    }
    expect(r.diagnosis.closed).toBe(true)
    expect(minArea).toBeGreaterThan(1e-6)
  })
})

describe('안팎과 빈 공간', () => {
  it.each([true, false])('속이 빈 상자 (합치기 %s)', async (union) => {
    const r = await run([...cube([0, 0, 0], 3), ...cube([1, 1, 1]).map(flip)], {}, union)
    expect(r.diagnosis.closed).toBe(true)
    expect(r.volume).toBeCloseTo(26, 4)
  })

  it('박힌 부품은 빈 공간으로 파내지 않는다', async () => {
    const r = await run([...cube([0, 0, 0], 3), ...cube([1, 1, 1])])
    expect(r.volume).toBeCloseTo(27, 4)
    expect(r.diagnosis.triangles).toBe(12)
  })

  it('법선이 통째로 뒤집힌 파일: 박힌 부품은 파내지 않고 진짜 빈 공간은 남긴다', async () => {
    expect((await run([...cube([0, 0, 0], 3), ...cube([1, 1, 1])].map(flip))).volume).toBeCloseTo(27, 4)
    expect((await run([...cube([0, 0, 0], 3).map(flip), ...cube([1, 1, 1])])).volume).toBeCloseTo(26, 4)
  })

  it('박힌 부품 안의 빈 공간은 깊이가 짝수여도 빈 공간으로 남는다', async () => {
    const t = [...cube([0, 0, 0], 9), ...cube([1, 1, 1], 7), ...cube([3, 3, 3], 3).map(flip)]
    const r = await run(t)
    expect(r.stats.cavities).toBe(1)
    expect(r.stats.reversed).toBe(0)
    expect(r.volume).toBeCloseTo(729, 3)
  })

  it('빈 공간 안의 섬 안의 빈 공간', async () => {
    const t = [...cube([0, 0, 0], 9), ...cube([1, 1, 1], 7).map(flip), ...cube([2, 2, 2], 5), ...cube([3, 3, 3], 3).map(flip)]
    expect((await run(t)).volume).toBeCloseTo(484, 3)
  })

  it('빈 공간 안의 빈 공간은 지우고 내역에도 세지 않는다', async () => {
    const inner = cube([4, 4, 4], 2).map(flip).slice(2)
    const r = await run([...cube([0, 0, 0], 10), ...cube([2, 2, 2], 6).map(flip), ...inner])
    expect(r.stats.nestedVoids).toBe(1)
    expect(r.stats.holesFilled).toBe(0)
    expect(r.volume).toBeCloseTo(784, 3)
  })

  it('바깥 셸이 열려 있어도 안쪽 빈 공간을 섬으로 뒤집지 않고 manifold에서 뺀다', async () => {
    const outer = cube([0, 0, 0], 3).filter((_, i) => i !== 2 && i !== 3)
    const r = await run([...outer, ...cube([1, 1, 1]).map(flip)], { fillHoles: false })
    expect(r.repaired.shells.find((s) => s.closed)?.cavity).toBe(true)
    expect(r.stats.reversed).toBe(0)
    expect(r.merged.rejected).toBe(0)
  })

  it('바깥 셸이 열린 채 통째로 뒤집힌 파일에서도 박힌 부품은 단단하게 둔다', async () => {
    const outer = cube([0, 0, 0], 3).filter((_, i) => i !== 2 && i !== 3)
    const r = await run([...outer, ...cube([1, 1, 1])].map(flip), { fillHoles: false })
    expect(r.stats.cavities).toBe(0)
  })

  it.each([0, 40, -40])('열린 상자는 위치(z=%s)와 상관없이 방향과 존재가 그대로', (z) => {
    const box = cube([0, 0, z], 10).filter((_, i) => i !== 2 && i !== 3)
    const r = repair(soup(box), { ...AUTO, fillHoles: false })
    expect(r.shells).toHaveLength(1)
    expect(r.stats.reversed).toBe(0)
    expect(r.stats.fragmentsRemoved).toBe(0)
  })

  it('닫힌 셸의 부피는 기준점과 무관하다', () => {
    const shell = repair(soup(cube([30, -20, 50], 2)), AUTO).shells[0]
    for (const o of [[0, 0, 0], [31, -19, 51], [-100, 7, 3]]) expect(signedVolume(shell.verts, shell.tris, o).volume).toBeCloseTo(8, 4)
  })
})

describe('망가진 좌표와 규모', () => {
  it.each([1e7, 1e20])('튄 꼭짓점(%s)은 걷어 내고 부품은 지킨다', (far) => {
    const started = performance.now()
    const r = repair(soup([...cube([0, 0, 0], 50), [0, 0, 0, far, 0, 0, 0, 1, 0]]), AUTO)
    expect(r.stats.outliers).toBe(1)
    expect(r.stats.weldTolerance).toBeLessThan(0.01)
    expect(Math.abs(r.shells.find((s) => s.closed)!.volume)).toBeCloseTo(125000, 0)
    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('지운 면만 쓰던 꼭짓점은 원본에 남기지 않는다(미리보기 범위가 부풀지 않게)', () => {
    const r = repair(soup([...cube([1000, 1000, 1000], 10), [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]]), AUTO)
    expect(r.before.verts.length / 3).toBe(8)
    expect(Math.min(...r.before.verts)).toBeGreaterThanOrEqual(1000)
  })

  it('한 점에 몰린 넓이 없는 면이 많아도 실제 모델을 튄 좌표로 지우지 않는다', () => {
    const junk = Array.from({ length: 3000 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0])
    const r = repair(soup([...cube([5, 5, 5]), ...junk]), AUTO)
    expect(r.stats.outliers).toBe(0)
    expect(r.shells).toHaveLength(1)
  })

  it('촘촘한 작은 부품 옆의 성긴 긴 막대도 지우지 않는다', async () => {
    const n = 60
    const t: Tris = []
    for (const [u, v, w, s] of [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]]) {
      const at = (i: number, j: number) => {
        const p = [0, 0, 0]
        p[u] = (i / n) * 5
        p[v] = (j / n) * 5
        p[w] = s > 0 ? 5 : 0
        return p
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
          const tri = (a: number[], b: number[], c: number[]) => (s > 0 ? [...a, ...b, ...c] : [...a, ...c, ...b])
          t.push(tri(q[0], q[1], q[2]), tri(q[0], q[2], q[3]))
        }
      }
    }
    t.push(...cube().map((tri) => tri.map((x, k) => (k % 3 === 0 ? x * 300 + 20 : x))))
    const r = await run(t)
    expect(r.stats.outliers).toBe(0)
    expect(r.diagnosis.shells).toBe(2)
    expect(r.diagnosis.closed).toBe(true)
  })

  it('떨어진 셸 8천 개의 포함 판정이 빨리 끝난다', () => {
    const t: Tris = []
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) for (let z = 0; z < 20; z++) t.push(...cube([x * 2, y * 2, z * 2]))
    const started = performance.now()
    const r = repair(soup(t), AUTO)
    expect(r.shells).toHaveLength(8000)
    expect(r.stats.cavities).toBe(0)
    expect(performance.now() - started).toBeLessThan(15000)
  }, 30000)

  it('길쭉한 삼각형뿐인 큰 원기둥 안의 빈 공간도 광선 색인이 터지지 않고 찾는다', () => {
    const t = [...cylinderSide(60000, [0, 100], undefined, 10), ...cylinderCaps(60000, 0, 100, 10), ...cube([-1, -1, 40], 2).map(flip)]
    const r = repair(soup(t), AUTO)
    expect(r.stats.cavities).toBe(1)
  }, 30000)

  it('190각형 굽은 구멍의 Liepa가 오래 걸리지 않는다', () => {
    const t = [...cylinderSide(400, [0, 0.5, 1, 1.5, 2], (i, r) => i < 95 && (r === 1 || r === 2)), ...cylinderCaps(400, 0, 2)]
    const started = performance.now()
    const r = repair(soup(t), AUTO)
    expect(r.stats.holesFilled).toBe(1)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
