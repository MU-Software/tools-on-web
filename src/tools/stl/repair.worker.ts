import { errorMessage } from '../../lib/error'
import { bounds, diagnose, repair, signedVolume, type Diagnosis, type RepairOptions, type RepairStats } from './repair'
import { parseStl, type Soup, type StlFormat } from './stl'
import { unionShells } from './union'

export type JobOptions = RepairOptions & { union: boolean }

export type Job = { id: number; fileId: number; file: File; options: JobOptions }

export type JobResult = {
  input: { format: StlFormat; name: string; triangles: number }
  before: {
    verts: Float32Array
    tris: Uint32Array
    boundaryLines: Uint32Array
    nonManifoldLines: Uint32Array
    diagnosis: Diagnosis
  }
  after: {
    verts: Float32Array
    tris: Uint32Array
    filled: Uint8Array
    diagnosis: Diagnosis
    volume: number
    area: number
    size: [number, number, number]
  }
  stats: RepairStats
  unioned: number
  rejected: number
  unionError?: string
  skipped: number
  elapsedMs: number
}

export type WorkerMessage = { id: number } & (
  | { type: 'stage'; stage: string }
  | { type: 'done'; result: JobResult }
  | { type: 'error'; message: string }
)

const post = (message: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

self.addEventListener('message', (event: MessageEvent<Job>) => {
  const { id } = event.data
  void run(event.data).catch((e: unknown) =>
    post({ id, type: 'error', message: errorMessage(e) }),
  )
})

// 옵션만 바꿔 다시 돌릴 때 원본을 또 받아 읽지 않도록 마지막으로 읽은 파일을 들고 있습니다.
let cached: { fileId: number; soup: Soup } | null = null

async function run({ id, fileId, file, options }: Job) {
  const started = performance.now()
  if (cached?.fileId !== fileId) {
    post({ id, type: 'stage', stage: '파일 읽는 중' })
    cached = null
    cached = { fileId, soup: parseStl(await file.arrayBuffer()) }
  }
  const { soup } = cached

  post({ id, type: 'stage', stage: '수리하는 중' })
  const repaired = repair(soup.positions, options)
  if (repaired.before.tris.length === 0) throw new Error('좌표가 잘못됐거나 넓이가 없는 삼각형뿐이라 수리할 것이 없습니다')

  if (options.union) post({ id, type: 'stage', stage: 'manifold로 셸 합치는 중' })
  const merged = await unionShells(repaired.shells, options.union)
  if (merged.tris.length === 0) {
    throw new Error('수리하고 나니 남은 삼각형이 없습니다. 두께 없는 조각뿐이었다면 "두께 없는 조각 지우기"를 꺼 보세요')
  }

  post({ id, type: 'stage', stage: '결과 검사 중' })
  const { volume, area } = signedVolume(merged.verts, merged.tris)
  const { min, max } = bounds(merged.verts)
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

  const result: JobResult = {
    input: { format: soup.format, name: soup.name, triangles: soup.positions.length / 9 },
    before: {
      ...repaired.before,
      boundaryLines: repaired.boundaryLines,
      nonManifoldLines: repaired.nonManifoldLines,
      diagnosis: repaired.beforeDiagnosis,
    },
    after: {
      verts: merged.verts,
      tris: merged.tris,
      filled: merged.filled,
      diagnosis: diagnose(merged).diagnosis,
      volume,
      area,
      size,
    },
    stats: repaired.stats,
    unioned: merged.unioned,
    rejected: merged.rejected,
    unionError: merged.unionError,
    skipped: merged.skipped,
    elapsedMs: performance.now() - started,
  }
  post({ id, type: 'done', result }, [
    result.before.verts.buffer,
    result.before.tris.buffer,
    result.before.boundaryLines.buffer,
    result.before.nonManifoldLines.buffer,
    result.after.verts.buffer,
    result.after.tris.buffer,
    result.after.filled.buffer,
  ])
}
