import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { formatSize } from '../../lib/bytes'
import { downloadBlob } from '../../lib/download'
import { useDocumentDrop } from '../../lib/useDocumentDrop'
import { writeStl } from './stl'
import type { Diagnosis } from './repair'
import type { Job, JobOptions, JobResult, WorkerMessage } from './repair.worker'
import { VIEW_COLORS } from './colors'

// three.js가 크므로 결과가 나온 뒤에 받습니다.
// 배포가 바뀌어 예전 청크를 받지 못해도 페이지 전체가 무너지지 않고 미리보기 자리만 비웁니다.
const StlViewer = lazy(() =>
  import('./StlViewer').catch(() => ({
    default: () => (
      <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
        미리보기를 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.
      </Typography>
    ),
  })),
)

const TOLERANCES: { value: JobOptions['weldTolerance']; label: string }[] = [
  { value: 'auto', label: '자동 (대각선의 100만분의 1)' },
  { value: 0, label: '정확히 같은 좌표만' },
  { value: 0.0001, label: '0.0001 mm' },
  { value: 0.001, label: '0.001 mm' },
  { value: 0.01, label: '0.01 mm' },
  { value: 0.1, label: '0.1 mm' },
]

const STITCH_GAPS: { value: JobOptions['stitchGap']; label: string }[] = [
  { value: 'auto', label: '자동 (대각선의 5000분의 1, 최대 0.05 mm)' },
  { value: 0, label: '꿰매지 않음' },
  { value: 0.001, label: '0.001 mm' },
  { value: 0.01, label: '0.01 mm' },
  { value: 0.05, label: '0.05 mm' },
  { value: 0.1, label: '0.1 mm' },
]

const DEFAULT_OPTIONS: JobOptions = {
  weldTolerance: 'auto',
  stitchGap: 'auto',
  fillHoles: true,
  removeFragments: true,
  union: true,
}

type Source = { id: number; file: File }

const num = (n: number) => n.toLocaleString('ko-KR')
const dec = (n: number, digits = 2) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

const DIAGNOSIS_ROWS: { label: string; get: (d: Diagnosis) => ReactNode; bad?: (d: Diagnosis) => boolean }[] = [
  { label: '삼각형', get: (d) => num(d.triangles) },
  { label: '꼭짓점', get: (d) => num(d.vertices) },
  { label: '셸(떨어진 덩어리)', get: (d) => num(d.shells) },
  { label: '열린 모서리', get: (d) => num(d.boundaryEdges), bad: (d) => d.boundaryEdges > 0 },
  { label: '비다양체 모서리', get: (d) => num(d.nonManifoldEdges), bad: (d) => d.nonManifoldEdges > 0 },
  { label: '방향 어긋난 모서리', get: (d) => num(d.inconsistentEdges), bad: (d) => d.inconsistentEdges > 0 },
  { label: '닫힌 입체', get: (d) => (d.closed ? '예' : '아니요'), bad: (d) => !d.closed },
]

function repairLog(result: JobResult) {
  const s = result.stats
  const done = [
    s.nonFinite > 0 && `좌표가 NaN·무한대인 삼각형 ${num(s.nonFinite)}개 제거`,
    s.outliers > 0 && `모델에서 터무니없이 멀리 튄 꼭짓점이 있는 삼각형 ${num(s.outliers)}개 제거`,
    `꼭짓점 ${num(s.rawVertices)}개를 ${num(s.weldedVertices)}개로 용접 (허용 오차 ${s.weldTolerance > 0 ? `${s.weldTolerance.toExponential(1)} mm` : '0'})`,
    s.degenerate > 0 && `넓이가 없는 삼각형 ${num(s.degenerate)}개 제거`,
    s.duplicate > 0 && `중복 삼각형 ${num(s.duplicate)}개 제거`,
    s.internal > 0 && `맞붙은 물체 사이의 내부 벽 ${num(s.internal)}개 제거`,
    s.stitched > 0 && `벌어진 이음매 모서리 ${num(s.stitched)}쌍 꿰맴 (최대 ${dec(s.stitchGap, 4)} mm)`,
    s.tJunctions > 0 && `T자 이음 ${num(s.tJunctions)}곳에서 면을 나눠 맞춤`,
    s.pinches > 0 && `자기 자신과 맞닿은 모서리 ${num(s.pinches)}개 분리`,
    s.reversed > 0 && `법선 ${num(s.reversed)}개 뒤집음`,
    s.holesFilled > 0 && `구멍 ${num(s.holesFilled)}개 메움 (삼각형 ${num(s.fillTriangles)}개 추가)`,
    s.fragmentsRemoved > 0 && `두께 없는 조각 ${num(s.fragmentsRemoved)}개 제거`,
    s.cavities > 0 && `내부 빈 공간 ${num(s.cavities)}개 유지`,
    s.nestedVoids > 0 && `빈 공간 안에 든 빈 공간 ${num(s.nestedVoids)}개 제거`,
    result.unioned > 1 && `떨어진 덩어리 ${num(result.unioned)}개를 manifold로 합침`,
  ].filter((v): v is string => !!v)
  const left = [
    s.nonOrientable > 0 && `앞뒤를 정할 수 없는 셸 ${num(s.nonOrientable)}개 (뫼비우스 띠 꼴)`,
    s.holesUnfilled > 0 && `둘레가 끊겨 메우지 못한 구멍 ${num(s.holesUnfilled)}개`,
    s.openShells > 0 && `닫지 못한 셸 ${num(s.openShells)}개`,
    result.rejected > 0 && `manifold가 받아들이지 못해 그대로 둔 셸 ${num(result.rejected)}개 (서로 겹쳐 있을 수 있음)`,
    result.unionError && `셸을 합치지 않았습니다: ${result.unionError}`,
    result.skipped > 1 &&
      `겹친 셸 합치기를 꺼서 떨어진 덩어리 ${num(result.skipped)}개를 그대로 두었습니다 (서로 겹쳐 있으면 슬라이서에서 문제가 될 수 있음)`,
  ].filter((v): v is string => !!v)
  return { done, left }
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
      {items.map(([color, label]) => (
        <Stack key={label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, flex: 'none' }} />
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

export default function StlRepair() {
  const [source, setSource] = useState<Source | null>(null)
  const [options, setOptions] = useState<JobOptions>(DEFAULT_OPTIONS)
  const [result, setResult] = useState<JobResult | null>(null)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<'before' | 'after'>('after')
  const workerRef = useRef<Worker | null>(null)
  const jobRef = useRef(0)
  const runningRef = useRef(false)

  // 워커는 띄워 둔 채 다시 써서 manifold wasm을 매번 새로 받지 않습니다.
  // 돌고 있는 작업을 끊는 방법은 워커 종료뿐이라 그때만 새로 띄웁니다.
  const start = useCallback((file: Source, opts: JobOptions) => {
    if (runningRef.current) {
      workerRef.current?.terminate()
      workerRef.current = null
    }
    let worker = workerRef.current
    if (!worker) {
      const created = new Worker(new URL('./repair.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const message = e.data
        // 끊긴 이전 작업의 메시지가 뒤늦게 와도 새 작업 상태를 덮지 않게 거릅니다.
        if (message.id !== jobRef.current) return
        if (message.type === 'stage') {
          setStage(message.stage)
          return
        }
        runningRef.current = false
        setStage('')
        if (message.type === 'done') {
          // 수리 도중 실수로 놓은 것 때문에 생긴 안내가 성공한 결과 옆에 남지 않게 지웁니다.
          setError('')
          setResult(message.result)
        }
        else {
          setResult(null)
          setError(message.message)
        }
      }
      created.onerror = (e) => {
        if (workerRef.current !== created) return
        created.terminate()
        workerRef.current = null
        runningRef.current = false
        setStage('')
        setResult(null)
        setError(e.message || '워커를 실행하지 못했습니다')
      }
      workerRef.current = worker = created
    }
    const id = ++jobRef.current
    runningRef.current = true
    setError('')
    setStage('준비 중')
    // File은 바이트를 복사하지 않고 넘어가므로 매번 보내고, 같은 파일이면 워커가 읽어 둔 것을 씁니다.
    worker.postMessage({ id, fileId: file.id, file: file.file, options: opts } satisfies Job)
  }, [])

  const fileIdRef = useRef(0)

  const open = useCallback(
    (file: File | null) => {
      if (!file) return
      const next = { id: ++fileIdRef.current, file }
      setSource(next)
      setResult(null)
      start(next, options)
    },
    [options, start],
  )

  const update = (patch: Partial<JobOptions>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    if (source) start(source, next)
  }

  // Fast Refresh는 정리 함수를 부른 뒤 ref를 그대로 둔 채 효과를 다시 돌리므로, 종료한 워커를 비워 둡니다.
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
      runningRef.current = false
    },
    [],
  )

  const dragging = useDocumentDrop((data) => {
    const file = data?.files[0]
    if (file) open(file)
    // 결과를 보고 있을 때 실수로 놓은 글자·링크 때문에 멀쩡한 결과 위에 오류를 띄우지 않습니다.
    else if (!result) setError('파일을 찾을 수 없습니다')
  })

  const download = () => {
    if (!source || !result) return
    const { verts, tris } = result.after
    downloadBlob(writeStl(verts, tris, result.input.name), `${source.file.name.replace(/\.stl$/i, '')}_repaired.stl`)
  }

  const busy = !!stage
  const log = result && repairLog(result)
  const after = result?.after

  return (
    <Stack spacing={2}>
      <input
        id="stl-repair-file"
        type="file"
        accept=".stl,model/stl,application/sla"
        hidden
        onChange={(e) => {
          open(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />

      <Card variant="outlined">
        <CardContent>
          <Box
            component="label"
            htmlFor="stl-repair-file"
            sx={{
              display: 'block',
              borderRadius: 2,
              border: '2px dashed',
              borderColor: dragging ? 'primary.main' : 'divider',
              bgcolor: dragging ? 'action.selected' : 'action.hover',
              p: source ? 2 : 4,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color .15s, background-color .15s',
            }}
          >
            {source ? (
              <Stack spacing={0.25}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {source.file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatSize(source.file.size)}
                  {result && ` · ${result.input.format === 'binary' ? '바이너리' : 'ASCII'} STL · 삼각형 ${num(result.input.triangles)}개`}
                  {' · 눌러서 다른 파일 고르기'}
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={0.5}>
                <Typography variant="body2">여기를 눌러 STL 파일을 고르거나</Typography>
                <Typography variant="body2">파일을 끌어다 놓아 주세요</Typography>
                <Typography variant="caption" color="text.secondary">
                  바이너리·ASCII 모두 됩니다. 파일은 업로드되지 않고 브라우저 안에서만 처리합니다.
                </Typography>
              </Stack>
            )}
          </Box>
          {(busy || result) && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', minHeight: 24 }}>
              {busy && <CircularProgress size={16} />}
              <Typography variant="caption" color="text.secondary">
                {busy ? `${stage}…` : result && `${dec(result.elapsedMs / 1000)}초 걸림`}
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel id="stl-weld">꼭짓점 용접 허용 오차</InputLabel>
                <Select
                  labelId="stl-weld"
                  label="꼭짓점 용접 허용 오차"
                  value={String(options.weldTolerance)}
                  onChange={(e) =>
                    update({ weldTolerance: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })
                  }
                >
                  {TOLERANCES.map((t) => (
                    <MenuItem key={String(t.value)} value={String(t.value)}>
                      {t.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="stl-stitch">틈 꿰매기 최대 거리</InputLabel>
                <Select
                  labelId="stl-stitch"
                  label="틈 꿰매기 최대 거리"
                  value={String(options.stitchGap)}
                  onChange={(e) => update({ stitchGap: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
                >
                  {STITCH_GAPS.map((t) => (
                    <MenuItem key={String(t.value)} value={String(t.value)}>
                      {t.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2 }}>
              <FormControlLabel
                control={<Switch checked={options.fillHoles} onChange={(e) => update({ fillHoles: e.target.checked })} />}
                label="구멍 메우기"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={options.removeFragments}
                    onChange={(e) => update({ removeFragments: e.target.checked })}
                  />
                }
                label="두께 없는 조각 지우기"
              />
              <FormControlLabel
                control={<Switch checked={options.union} onChange={(e) => update({ union: e.target.checked })} />}
                label="겹친 셸 합치기 (manifold)"
              />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {result && after && log && (
        <>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={view}
                    onChange={(_, value: 'before' | 'after' | null) => value && setView(value)}
                  >
                    <ToggleButton value="before">원본</ToggleButton>
                    <ToggleButton value="after">수리 결과</ToggleButton>
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary">
                    끌어서 회전 · 휠로 확대 · 오른쪽 끌기로 이동
                  </Typography>
                </Stack>
                <Suspense
                  fallback={
                    <Box sx={{ height: { xs: 320, sm: 440 }, display: 'grid', placeItems: 'center' }}>
                      <CircularProgress size={24} />
                    </Box>
                  }
                >
                  <StlViewer key={source?.id} result={result} view={view} />
                </Suspense>
                <Legend
                  items={
                    view === 'before'
                      ? [
                          [VIEW_COLORS.boundary, '열린 모서리'],
                          [VIEW_COLORS.nonManifold, '비다양체 모서리'],
                          [VIEW_COLORS.back, '뒷면이 보이는 곳 (법선 뒤집힘·구멍 안쪽)'],
                        ]
                      : [
                          [VIEW_COLORS.filled, '메운 면'],
                          [VIEW_COLORS.back, '뒷면이 보이는 곳'],
                        ]
                  }
                />
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                {after.diagnosis.closed && log.left.length === 0 ? (
                  <Alert severity="success">
                    <AlertTitle>닫힌 입체가 되었습니다</AlertTitle>
                    열린 모서리와 비다양체 모서리가 없고, 모든 면의 방향이 맞습니다.
                  </Alert>
                ) : after.diagnosis.closed ? (
                  // 셸마다 닫혀 있어도 합치지 못한 셸끼리 겹쳐 있으면 슬라이서에서 문제가 될 수 있습니다.
                  <Alert severity="warning">
                    <AlertTitle>닫혔지만 확인할 점이 있습니다</AlertTitle>
                    {log.left.join(' · ')}
                  </Alert>
                ) : (
                  <Alert severity="warning">
                    <AlertTitle>아직 닫히지 않은 곳이 있습니다</AlertTitle>
                    {log.left.length > 0 ? log.left.join(' · ') : '아래 표에서 남은 문제를 확인해 주세요.'}
                  </Alert>
                )}

                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell />
                        <TableCell align="right">원본</TableCell>
                        <TableCell align="right">수리 결과</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {DIAGNOSIS_ROWS.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell>{row.label}</TableCell>
                          {[result.before.diagnosis, after.diagnosis].map((d, i) => (
                            <TableCell
                              key={i}
                              align="right"
                              sx={{ color: row.bad?.(d) ? 'error.main' : undefined, fontVariantNumeric: 'tabular-nums' }}
                            >
                              {row.get(d)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  원본 수치는 꼭짓점 용접과 중복 제거를 마친 뒤에 잰 값입니다.
                </Typography>

                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    수리 내역
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {log.done.map((line) => (
                      <Typography key={line} component="li" variant="body2">
                        {line}
                      </Typography>
                    ))}
                  </Box>
                </Box>

                <Typography variant="body2" color="text.secondary">
                  크기 {after.size.map((v) => dec(v)).join(' × ')}
                  {/* 열린 셸이 남으면 원점에 따라 달라지고, 합치지 않은 셸끼리 겹치면 겹친 만큼 더해지므로 그때는 숨깁니다. */}
                  {after.diagnosis.closed &&
                    result.rejected === 0 &&
                    !result.unionError &&
                    result.skipped <= 1 &&
                    ` · 부피 ${dec(after.volume / 1000)} cm³`}{' '}
                  · 표면적 {dec(after.area / 100)} cm²
                  (단위가 mm일 때)
                </Typography>

                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Button variant="contained" onClick={download} disabled={busy}>
                    수리한 STL 내려받기
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    바이너리 · {formatSize(84 + 50 * after.diagnosis.triangles)}
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Typography variant="caption" color="text.secondary">
            한 셸이 스스로를 뚫고 지나가는 자기 교차는 고치지 않습니다. 메운 면은 둘레 꼭짓점만으로 잇기
            때문에, 큰 구멍은 원래 곡면과 모양이 다를 수 있습니다.
          </Typography>
        </>
      )}
    </Stack>
  )
}
