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

const SOURCES = {
  apple: 'https://www.ios-resolution.com/',
  generic: 'https://screensiz.es/',
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

/** ios-resolution.com: 이름 · 논리 해상도 · 물리 해상도 · PPI · 배율 */
function parseApple(html) {
  const out = []
  for (const row of rowsOf(html)) {
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => stripTags(m[1]))
    if (cells.length < 7) continue
    const [name, cssW, cssH, , , ppi, scale] = cells
    if (!name || !num(ppi) || !num(cssW)) continue
    // 시계는 이 도구로 열 일이 없다
    if (/^Apple Watch/i.test(name)) continue
    out.push({
      name,
      ppi: Math.round(num(ppi)),
      css: [Math.min(num(cssW), num(cssH)), Math.max(num(cssW), num(cssH))],
      dpr: num(scale) || 1,
      kind: /iPad/i.test(name) ? 'tablet' : 'phone',
      platform: /iPad/i.test(name) ? 'ipad' : 'ios',
    })
  }
  return out
}

/** screensiz.es: 제조사 무관 화면 목록. 논리 해상도가 빠진 행이 많아 PPI 위주로 쓴다. */
function parseGeneric(html) {
  const out = []
  for (const row of rowsOf(html)) {
    const cells = Object.fromEntries(
      [...row.matchAll(/<t[dh][^>]*class="([^"]*)"[^>]*>(.*?)<\/t[dh]>/gs)].map((m) => [
        m[1].split(/\s+/)[0],
        stripTags(m[2]),
      ]),
    )
    const name = cells['persist'] ?? cells['name-value']
    const ppi = Math.round(num(cells['ppi-value']))
    const inches = num(cells['physical_size_in-value'])
    const os = cells['operating_system-value'] ?? ''
    if (!name || !ppi || !inches || name.toLowerCase() === 'device') continue
    if (/^{{/.test(name)) continue
    // 아이폰·아이패드는 ios-resolution.com 쪽이 더 정확하고 최신이라 여기서는 뺀다
    if (os === 'iOS' || /^Apple (iPhone|iPad|iPod)/i.test(name)) continue

    const pxW = num(cells['px_width-value'])
    const pxH = num(cells['px_height-value'])
    const cssW = num(cells['device_width-value'])
    const dpr = num((cells['px_density-value'] ?? '').match(/(\d+)%/)?.[1]) / 100

    const kind =
      os === 'Windows' || os === 'OS X' || os === 'Chrome'
        ? inches <= 18
          ? 'laptop'
          : 'desktop'
        : inches < 7
          ? 'phone'
          : 'tablet'

    const row2 = { name: `${tidy(name)} (${inches}")`, ppi, kind }
    if (dpr && pxW && pxH) {
      const css = [
        Math.round(Math.min(pxW, pxH) / dpr),
        Math.round(Math.max(pxW, pxH) / dpr),
      ]
      // 표에 적힌 논리 너비와 어긋나면 자료가 부정확한 것이니 화면 크기 매칭에서 뺀다
      if (!cssW || css.some((v) => Math.abs(v - cssW) <= 2)) {
        row2.css = css
        row2.dpr = dpr
      }
    }
    out.push(row2)
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

/** 'BlackBerry BlackBerry Priv'처럼 제조사가 겹쳐 적힌 이름을 다듬는다. */
const tidy = (name) => {
  const words = name.split(' ')
  return words[0] === words[1] ? words.slice(1).join(' ') : name
}

const dedupe = (rows) => {
  const seen = new Set()
  return rows.filter((r) => {
    const key = `${r.name.toLowerCase().replace(/[^a-z0-9]/g, '')}/${r.ppi}`
    return !seen.has(key) && seen.add(key)
  })
}

const ts = (value) => JSON.stringify(value)

async function main() {
  console.log('· 자료 내려받는 중…')
  const [appleHtml, genericHtml, catalogBuf, curatedRaw] = await Promise.all([
    get(SOURCES.apple),
    get(SOURCES.generic),
    get(SOURCES.playCatalog, true),
    readFile(CURATED, 'utf8'),
  ])

  const apple = mergeSameScreens(parseApple(appleHtml)).sort((a, b) => a.name.localeCompare(b.name))
  const generic = dedupe(parseGeneric(genericHtml)).sort(
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
    ['기타 기기', generic.length, 100],
    ['모델 코드', Object.keys(modelIndex).length, 100],
  ].filter(([, got, least]) => got < least)
  if (enough.length) {
    throw new Error(
      `자료가 너무 적습니다(출처 구조가 바뀌었을 수 있음): ` +
        enough.map(([what, got, least]) => `${what} ${got}개 < ${least}개`).join(', '),
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const body = `// 이 파일은 \`pnpm devices:update\`가 만듭니다. 직접 고치지 마세요.
// 수집일: ${today}
// 출처:
//   - ${SOURCES.apple} (Apple 논리·물리 해상도와 PPI)
//   - ${SOURCES.generic} (제조사 무관 화면 크기와 PPI)
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
