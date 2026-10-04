#!/usr/bin/env node
/**
 * 화면 자 도구가 쓰는 장치 DB를 공개 자료에서 다시 만듭니다.
 *
 *   pnpm devices:update
 *
 * 실행 결과는 src/tools/ruler/devices.generated.ts 한 파일입니다.
 * 새 기기가 나오면(대략 반년에 한 번) 다시 돌려 주세요.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/tools/ruler/devices.generated.ts')
const CURATED = resolve(HERE, 'curated-devices.json')
// screensiz.es가 2019년쯤 갱신을 멈추고 2026-10에는 응답도 없어, 마지막 자료를 여기 옮겨 두고 직접 관리한다
const GENERIC = resolve(HERE, 'generic-devices.json')

const SOURCES = {
  apple: 'https://www.ios-resolution.com/',
  playCatalog: 'https://storage.googleapis.com/play_public/supported_devices.csv',
}

const UA = 'tools-on-web ruler device-db updater (+https://github.com/MUsoftware/tools-on-web)'

async function get(url, binary = false) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text()
}

const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const rowsOf = (html) =>
  [...html.replace(/<!--.*?-->/gs, '').matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => m[1])
const num = (text) => {
  const value = Number(String(text).replace(/[^0-9.]/g, ''))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** ios-resolution.com: 이름 · 논리 해상도 · PPI · 배율 */
function parseApple(html) {
  const cellsOf = (row, tag) =>
    [...row.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gs'))].map((m) => stripTags(m[1]))
  const rows = rowsOf(html)
  // 열이 끼어드는 일이 있어(2026-10에 'More Space' 추가) 위치가 아니라 머리글 이름으로 찾는다
  const header = cellsOf(rows.find((row) => /<th/.test(row)) ?? '', 'th')
  const wanted = {
    name: 'Family & Model',
    cssW: 'Logical Width',
    cssH: 'Logical Height',
    ppi: 'PPI',
    scale: 'Scale Factor',
  }
  const at = Object.fromEntries(Object.entries(wanted).map(([key, title]) => [key, header.indexOf(title)]))
  const lost = Object.entries(at).filter(([, index]) => index < 0)
  if (lost.length) {
    throw new Error(`${SOURCES.apple} 표 머리글이 바뀌었습니다: ${lost.map(([key]) => wanted[key]).join(', ')} 없음`)
  }

  const out = []
  for (const row of rows) {
    const cells = cellsOf(row, 'td')
    if (cells.length < header.length) continue
    const name = cells[at.name]
    const [cssW, cssH, ppi, scale] = [at.cssW, at.cssH, at.ppi, at.scale].map((i) => num(cells[i]))
    if (!name || !ppi || !cssW) continue
    // 시계는 이 도구로 열 일이 없다
    if (/^Apple Watch/i.test(name)) continue
    out.push({
      name,
      ppi: Math.round(ppi),
      css: [Math.min(cssW, cssH), Math.max(cssW, cssH)],
      dpr: scale || 1,
      kind: /iPad/i.test(name) ? 'tablet' : 'phone',
      platform: /iPad/i.test(name) ? 'ipad' : 'ios',
    })
  }
  return out
}

/** Play 콘솔 공개 카탈로그로 모델 코드(SM-S928B 등) ↔ 제품명을 잇는다. */
function parsePlayCatalog(buffer) {
  const text = buffer.toString('utf16le')
  const out = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cells.length < 4) continue
    const [brand, marketing] = cells
    const model = cells[cells.length - 1]
    if (!model || !marketing) continue
    out.push({ brand: brand.trim(), marketing: marketing.trim(), model })
  }
  return out
}

/** 논리 해상도·배율·PPI가 같은 기기는 한 줄로 합친다. 자 입장에서는 같은 화면이다. */
const mergeSameScreens = (rows) => {
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.css.join('x')}@${row.dpr}/${row.ppi}`
    const found = groups.get(key)
    if (found) found.names.push(row.name)
    else groups.set(key, { ...row, names: [row.name] })
  }
  return [...groups.values()].map((group) => {
    const names = [...new Set(group.names)]
    const label = names.length > 3 ? `${names.slice(0, 3).join(' · ')} 등` : names.join(' · ')
    return { ...group, name: label }
  })
}

const ts = (value) => JSON.stringify(value)

async function main() {
  console.log('· 자료 내려받는 중…')
  const [appleHtml, catalogBuf, curatedRaw, genericRaw] = await Promise.all([
    get(SOURCES.apple),
    get(SOURCES.playCatalog, true),
    readFile(CURATED, 'utf8'),
    readFile(GENERIC, 'utf8'),
  ])

  const apple = mergeSameScreens(parseApple(appleHtml)).sort((a, b) => a.name.localeCompare(b.name))
  const generic = JSON.parse(genericRaw).sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  )
  const catalog = parsePlayCatalog(catalogBuf)
  const curated = JSON.parse(curatedRaw)

  // 손으로 관리하는 제품명 목록을, 카탈로그를 거쳐 모델 코드 전부로 넓힌다
  const modelIndex = {}
  const missing = []
  curated.forEach((device, index) => {
    const matches = catalog.filter(
      (c) =>
        c.marketing.toLowerCase() === device.name.toLowerCase() &&
        (!device.brand || c.brand.toLowerCase() === device.brand.toLowerCase()),
    )
    if (!matches.length) missing.push(device.name)
    for (const match of matches) modelIndex[match.model] = index
    // UA-CH가 제품명을 그대로 주는 기기(Pixel 등)도 찾을 수 있게 해 둔다
    modelIndex[device.name] = index
  })

  if (missing.length) console.warn('⚠ 카탈로그에서 못 찾은 제품명:', missing.join(', '))

  // 출처가 HTML 스크래핑이라, 사이트 구조가 바뀌면 조용히 빈 표가 만들어질 수 있다
  const enough = [
    ['Apple 기기', apple.length, 20],
    ['모델 코드', Object.keys(modelIndex).length, 100],
  ].filter(([, got, least]) => got < least)
  if (enough.length) {
    throw new Error(
      `자료가 너무 적습니다(출처 구조가 바뀌었을 수 있음): ` +
        enough.map(([what, got, least]) => `${what} ${got}개 < ${least}개`).join(', '),
    )
  }
  // 열이 밀리면 개수는 그대로인 채 해상도가 PPI 자리에 들어가므로 값 범위도 본다
  const odd = [...apple, ...generic, ...curated].filter(
    (d) => !(d.ppi >= 60 && d.ppi <= 1000) || (d.dpr !== undefined && !(d.dpr >= 1 && d.dpr <= 5)),
  )
  if (odd.length) {
    throw new Error(
      `값이 이상한 기기가 있습니다(출처 구조가 바뀌었을 수 있음): ` +
        odd.slice(0, 5).map((d) => `${d.name} ppi=${d.ppi} dpr=${d.dpr}`).join(', '),
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const body = `// 이 파일은 \`pnpm devices:update\`가 만듭니다. 직접 고치지 마세요.
// 수집일: ${today}
// 출처:
//   - ${SOURCES.apple} (Apple 논리·물리 해상도와 PPI)
//   - scripts/generic-devices.json (제조사 무관 화면 크기와 PPI, screensiz.es 자료를 옮겨 직접 관리)
//   - ${SOURCES.playCatalog} (안드로이드 모델 코드 ↔ 제품명)
//   - scripts/curated-devices.json (최신 안드로이드 기기 PPI, 직접 관리)

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop'

export type DeviceRow = {
  name: string
  ppi: number
  kind: DeviceKind
  /** 논리 해상도(짧은 변, 긴 변). 있으면 화면 크기만으로 이 기기를 골라낼 수 있다. */
  css?: [number, number]
  dpr?: number
  platform?: 'ios' | 'ipad'
}

export const DEVICE_DB_DATE = '${today}'

export const APPLE_DEVICES: DeviceRow[] = [
${apple.map((d) => `  { name: ${ts(d.name)}, ppi: ${d.ppi}, kind: '${d.kind}', css: [${d.css[0]}, ${d.css[1]}], dpr: ${d.dpr}, platform: '${d.platform}' },`).join('\n')}
]

export const OTHER_DEVICES: DeviceRow[] = [
${generic.map((d) => `  { name: ${ts(d.name)}, ppi: ${d.ppi}, kind: '${d.kind}'${d.css ? `, css: [${d.css[0]}, ${d.css[1]}], dpr: ${d.dpr}` : ''} },`).join('\n')}
]

/** UA Client Hints가 알려주는 모델 코드로 찾는 표 */
export const CURATED: readonly (readonly [name: string, ppi: number])[] = [
${curated.map((d) => `  [${ts(d.name)}, ${d.ppi}],`).join('\n')}
]

export const MODEL_INDEX: Readonly<Record<string, number>> = {
${Object.entries(modelIndex)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([model, index]) => `  ${ts(model)}: ${index},`)
  .join('\n')}
}
`

  await writeFile(OUT, body)
  console.log(
    `· 완료: Apple ${apple.length}대, 기타 ${generic.length}대, 모델 코드 ${Object.keys(modelIndex).length}개`,
  )
  console.log(`· ${OUT}`)
}

main().catch((error) => {
  console.error('✗ 장치 DB 갱신 실패:', error.message)
  process.exit(1)
})
