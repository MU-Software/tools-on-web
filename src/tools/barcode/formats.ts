// 심볼별 인코더를 개별 import 해야 번들러가 나머지 100여 종을 걷어냅니다.
// (범용 toCanvas/toSVG는 bcid 룩업 테이블을 거치므로 전체 심볼이 딸려옵니다.)
import {
  azteccode,
  code128,
  code39,
  code93,
  datamatrix,
  ean13,
  pdf417,
  qrcode,
  upca,
  type RenderOptions,
} from 'bwip-js/browser'

type Encoder = typeof qrcode

export type FormatGroup = '2D' | '1D' | 'GTIN'

export type BarcodeFormat = {
  /** bwip-js 심볼 id */
  bcid: string
  label: string
  group: FormatGroup
  desc: string
  render: Encoder
  /** 심볼이 대문자만 허용하는 경우 */
  upperOnly?: boolean
  opts?: Omit<RenderOptions, 'bcid' | 'text'>
}

export const GROUPS: { group: FormatGroup; label: string }[] = [
  { group: '2D', label: '2D 코드' },
  { group: '1D', label: '1D 코드' },
  { group: 'GTIN', label: '유통 표준 (숫자 전용)' },
]

/** 조용한 영역: bwip-js의 padding은 스케일 1 기준 픽셀이며 2D 심볼은 1모듈 = 2px */
const QUIET_2D = 8
const QUIET_1D = 6

/** 사람이 읽는 숫자와 가드바를 함께 그리는 유통 표준 코드의 공통 옵션 */
const GTIN_OPTS = {
  padding: QUIET_1D,
  height: 18,
  includetext: true,
  guardwhitespace: true,
} as const

export const FORMATS: BarcodeFormat[] = [
  {
    bcid: 'qrcode',
    label: 'QR Code',
    group: '2D',
    desc: '가장 널리 쓰이는 2D 코드. 휴대폰 카메라로 바로 읽힙니다.',
    render: qrcode,
    opts: { padding: QUIET_2D },
  },
  {
    bcid: 'datamatrix',
    label: 'Data Matrix',
    group: '2D',
    desc: '같은 데이터를 가장 작게 담습니다. 소형 라벨·부품 각인에 적합합니다.',
    render: datamatrix,
    opts: { padding: QUIET_2D },
  },
  {
    bcid: 'azteccode',
    label: 'Aztec',
    group: '2D',
    desc: '조용한 영역이 거의 필요 없어 여백이 좁은 라벨에 유리합니다.',
    render: azteccode,
    opts: { padding: QUIET_2D },
  },
  {
    bcid: 'pdf417',
    label: 'PDF417',
    group: '2D',
    desc: '가로로 긴 적층형 코드. 신분증·운송장에서 주로 쓰입니다.',
    render: pdf417,
    opts: { padding: QUIET_2D },
  },
  {
    bcid: 'code128',
    label: 'Code 128',
    group: '1D',
    desc: '전체 ASCII를 지원하는 1D 코드 중 가장 조밀합니다.',
    render: code128,
    opts: { padding: QUIET_1D, height: 14 },
  },
  {
    bcid: 'code93',
    label: 'Code 93',
    group: '1D',
    desc: 'Code 39보다 조밀하고 검사 문자가 2개 붙습니다. 대문자·숫자·-.$/+%·공백만 지원합니다.',
    render: code93,
    upperOnly: true,
    opts: { padding: QUIET_1D, height: 14 },
  },
  {
    bcid: 'code39',
    label: 'Code 39',
    group: '1D',
    desc: '구형 장비 호환성이 가장 좋지만 폭이 넓어집니다. 대문자·숫자·-.$/+%·공백만 지원합니다.',
    render: code39,
    upperOnly: true,
    opts: { padding: QUIET_1D, height: 14 },
  },
  {
    bcid: 'ean13',
    label: 'EAN-13',
    group: 'GTIN',
    desc: '숫자 12자리(체크 디지트 자동 계산) 또는 13자리. 국내외 소매 상품 표준입니다.',
    render: ean13,
    opts: GTIN_OPTS,
  },
  {
    bcid: 'upca',
    label: 'UPC-A',
    group: 'GTIN',
    desc: '숫자 11자리(체크 디지트 자동 계산) 또는 12자리. 북미 소매 상품 표준입니다.',
    render: upca,
    opts: GTIN_OPTS,
  },
]

/** 표기 옵션과 심볼 제약을 적용한 실제 인코딩 문자열 */
export function toPayload(text: string, upper: boolean, format: BarcodeFormat): string {
  return upper || format.upperOnly ? text.toUpperCase() : text
}
