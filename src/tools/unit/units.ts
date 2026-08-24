export type Unit = {
  id: string
  symbol: string
  label: string
  toBase: (v: number) => number
  fromBase: (v: number) => number
}

export type Category = {
  id: string
  label: string
  units: Unit[]
}

const linear = (id: string, symbol: string, label: string, factor: number): Unit => ({
  id,
  symbol,
  label,
  toBase: (v) => v * factor,
  fromBase: (v) => v / factor,
})

const mapped = (
  id: string,
  symbol: string,
  label: string,
  toBase: (v: number) => number,
  fromBase: (v: number) => number,
): Unit => ({ id, symbol, label, toBase, fromBase })

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    label: '길이',
    units: [
      linear('nm', 'nm', '나노미터', 1e-9),
      linear('um', 'µm', '마이크로미터', 1e-6),
      linear('mm', 'mm', '밀리미터', 1e-3),
      linear('cm', 'cm', '센티미터', 1e-2),
      linear('m', 'm', '미터', 1),
      linear('km', 'km', '킬로미터', 1e3),
      linear('in', 'in', '인치', 0.0254),
      linear('ft', 'ft', '피트', 0.3048),
      linear('yd', 'yd', '야드', 0.9144),
      linear('mi', 'mi', '마일', 1609.344),
      linear('nmi', 'nmi', '해리', 1852),
      linear('chi', '치', '치(寸)', 0.0303),
      linear('ja', '자', '자(尺)', 0.303),
      linear('au', 'AU', '천문단위', 1.495978707e11),
      linear('ly', 'ly', '광년', 9.4607304725808e15),
    ],
  },
  {
    id: 'mass',
    label: '무게',
    units: [
      linear('ug', 'µg', '마이크로그램', 1e-9),
      linear('mg', 'mg', '밀리그램', 1e-6),
      linear('g', 'g', '그램', 1e-3),
      linear('kg', 'kg', '킬로그램', 1),
      linear('t', 't', '톤', 1000),
      linear('ct', 'ct', '캐럿', 0.0002),
      linear('oz', 'oz', '온스', 0.028349523125),
      linear('lb', 'lb', '파운드', 0.45359237),
      linear('st', 'st', '스톤', 6.35029318),
      linear('ton_us', 'ton(US)', '미국톤', 907.18474),
      linear('ton_uk', 'ton(UK)', '영국톤', 1016.0469088),
      linear('don', '돈', '돈', 0.00375),
      linear('geun', '근', '근(600g)', 0.6),
      linear('gwan', '관', '관', 3.75),
    ],
  },
  {
    id: 'temperature',
    label: '온도',
    units: [
      mapped('c', '°C', '섭씨', (v) => v, (v) => v),
      mapped('f', '°F', '화씨', (v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32),
      mapped('k', 'K', '켈빈', (v) => v - 273.15, (v) => v + 273.15),
      mapped('r', '°R', '랭킨', (v) => ((v - 491.67) * 5) / 9, (v) => (v * 9) / 5 + 491.67),
    ],
  },
  {
    id: 'area',
    label: '넓이',
    units: [
      linear('mm2', 'mm²', '제곱밀리미터', 1e-6),
      linear('cm2', 'cm²', '제곱센티미터', 1e-4),
      linear('m2', 'm²', '제곱미터', 1),
      linear('a', 'a', '아르', 100),
      linear('ha', 'ha', '헥타르', 1e4),
      linear('km2', 'km²', '제곱킬로미터', 1e6),
      linear('in2', 'in²', '제곱인치', 0.00064516),
      linear('ft2', 'ft²', '제곱피트', 0.09290304),
      linear('yd2', 'yd²', '제곱야드', 0.83612736),
      linear('ac', 'ac', '에이커', 4046.8564224),
      linear('mi2', 'mi²', '제곱마일', 2589988.110336),
      linear('pyeong', '평', '평', 400 / 121),
    ],
  },
  {
    id: 'volume',
    label: '부피',
    units: [
      linear('ml', 'mL', '밀리리터', 1e-3),
      linear('l', 'L', '리터', 1),
      linear('cm3', 'cm³', '세제곱센티미터', 1e-3),
      linear('m3', 'm³', '세제곱미터', 1000),
      linear('in3', 'in³', '세제곱인치', 0.016387064),
      linear('ft3', 'ft³', '세제곱피트', 28.316846592),
      linear('tsp', 'tsp', '작은술(US)', 0.00492892159375),
      linear('tbsp', 'tbsp', '큰술(US)', 0.01478676478125),
      linear('floz', 'fl oz', '액량온스(US)', 0.0295735295625),
      linear('cup', 'cup', '컵(US)', 0.2365882365),
      linear('pt', 'pt', '파인트(US)', 0.473176473),
      linear('qt', 'qt', '쿼트(US)', 0.946352946),
      linear('gal', 'gal', '갤런(US)', 3.785411784),
      linear('gal_uk', 'gal(UK)', '갤런(영국)', 4.54609),
      linear('bbl', 'bbl', '배럴(석유)', 158.987294928),
      linear('doe', '되', '되', 1.80391),
      linear('mal', '말', '말', 18.0391),
    ],
  },
  {
    id: 'time',
    label: '시간',
    units: [
      linear('ns', 'ns', '나노초', 1e-9),
      linear('us', 'µs', '마이크로초', 1e-6),
      linear('ms', 'ms', '밀리초', 1e-3),
      linear('s', 's', '초', 1),
      linear('min', 'min', '분', 60),
      linear('h', 'h', '시간', 3600),
      linear('d', 'd', '일', 86400),
      linear('wk', 'wk', '주', 604800),
      linear('mo', 'mo', '개월(평균)', 2629746),
      linear('yr', 'yr', '년(평균)', 31556952),
    ],
  },
  {
    id: 'speed',
    label: '속도',
    units: [
      linear('mps', 'm/s', '미터/초', 1),
      linear('kmh', 'km/h', '킬로미터/시', 1 / 3.6),
      linear('mph', 'mph', '마일/시', 0.44704),
      linear('fps', 'ft/s', '피트/초', 0.3048),
      linear('kn', 'kn', '노트', 1852 / 3600),
      linear('mach', 'Mach', '마하(해면 15°C)', 340.29),
    ],
  },
  {
    id: 'data',
    label: '데이터',
    units: [
      linear('bit', 'bit', '비트', 0.125),
      linear('B', 'B', '바이트', 1),
      linear('KB', 'KB', '킬로바이트(10³)', 1e3),
      linear('KiB', 'KiB', '키비바이트(2¹⁰)', 1024),
      linear('MB', 'MB', '메가바이트', 1e6),
      linear('MiB', 'MiB', '메비바이트', 1024 ** 2),
      linear('GB', 'GB', '기가바이트', 1e9),
      linear('GiB', 'GiB', '기비바이트', 1024 ** 3),
      linear('TB', 'TB', '테라바이트', 1e12),
      linear('TiB', 'TiB', '테비바이트', 1024 ** 4),
      linear('PB', 'PB', '페타바이트', 1e15),
      linear('PiB', 'PiB', '페비바이트', 1024 ** 5),
    ],
  },
  {
    id: 'bitrate',
    label: '전송 속도',
    units: [
      linear('bps', 'bit/s', '비트/초', 1),
      linear('kbps', 'kbit/s', '킬로비트/초', 1e3),
      linear('mbps', 'Mbit/s', '메가비트/초', 1e6),
      linear('gbps', 'Gbit/s', '기가비트/초', 1e9),
      linear('kBps', 'kB/s', '킬로바이트/초', 8e3),
      linear('MBps', 'MB/s', '메가바이트/초', 8e6),
      linear('MiBps', 'MiB/s', '메비바이트/초', 8 * 1024 ** 2),
      linear('GBps', 'GB/s', '기가바이트/초', 8e9),
    ],
  },
  {
    id: 'pressure',
    label: '압력',
    units: [
      linear('pa', 'Pa', '파스칼', 1),
      linear('hpa', 'hPa', '헥토파스칼', 100),
      linear('kpa', 'kPa', '킬로파스칼', 1e3),
      linear('mpa', 'MPa', '메가파스칼', 1e6),
      linear('mbar', 'mbar', '밀리바', 100),
      linear('bar', 'bar', '바', 1e5),
      linear('atm', 'atm', '기압', 101325),
      linear('mmhg', 'mmHg', '수은주밀리미터', 133.322387415),
      linear('inhg', 'inHg', '수은주인치', 3386.388640341),
      linear('psi', 'psi', '제곱인치당 파운드', 6894.757293168),
      linear('kgfcm2', 'kgf/cm²', '제곱센티미터당 킬로그램힘', 98066.5),
    ],
  },
  {
    id: 'energy',
    label: '에너지',
    units: [
      linear('j', 'J', '줄', 1),
      linear('kj', 'kJ', '킬로줄', 1e3),
      linear('cal', 'cal', '칼로리', 4.184),
      linear('kcal', 'kcal', '킬로칼로리', 4184),
      linear('wh', 'Wh', '와트시', 3600),
      linear('kwh', 'kWh', '킬로와트시', 3.6e6),
      linear('mwh', 'MWh', '메가와트시', 3.6e9),
      linear('btu', 'BTU', '영국열량단위', 1055.05585262),
      linear('ev', 'eV', '전자볼트', 1.602176634e-19),
    ],
  },
  {
    id: 'power',
    label: '일률',
    units: [
      linear('w', 'W', '와트', 1),
      linear('kw', 'kW', '킬로와트', 1e3),
      linear('mw', 'MW', '메가와트', 1e6),
      linear('gw', 'GW', '기가와트', 1e9),
      linear('hp', 'hp', '영마력', 745.6998715822702),
      linear('ps', 'PS', '미터마력', 735.49875),
      linear('kcalh', 'kcal/h', '킬로칼로리/시', 1.163),
      linear('btuh', 'BTU/h', 'BTU/시', 0.29307107017),
    ],
  },
  {
    id: 'force',
    label: '힘',
    units: [
      linear('n', 'N', '뉴턴', 1),
      linear('kn', 'kN', '킬로뉴턴', 1e3),
      linear('kgf', 'kgf', '킬로그램힘', 9.80665),
      linear('lbf', 'lbf', '파운드힘', 4.4482216152605),
      linear('dyn', 'dyn', '다인', 1e-5),
    ],
  },
  {
    id: 'angle',
    label: '각도',
    units: [
      linear('deg', '°', '도', 1),
      linear('rad', 'rad', '라디안', 180 / Math.PI),
      linear('grad', 'grad', '그레이드', 0.9),
      linear('arcmin', '′', '분(각)', 1 / 60),
      linear('arcsec', '″', '초(각)', 1 / 3600),
      linear('turn', 'turn', '회전', 360),
      linear('mil', 'mil', '밀(NATO)', 360 / 6400),
    ],
  },
  {
    id: 'fuel',
    label: '연비',
    units: [
      linear('kmpl', 'km/L', '킬로미터/리터', 1),
      mapped('l100km', 'L/100km', '리터/100킬로미터', (v) => 100 / v, (v) => 100 / v),
      linear('mpg', 'mpg(US)', '마일/갤런(US)', 1609.344 / 3785.411784),
      linear('mpg_uk', 'mpg(UK)', '마일/갤런(영국)', 1609.344 / 4546.09),
    ],
  },
]

/** 입력에서 천 단위 쉼표와 공백을 걷어내고 숫자로 읽습니다. */
export function parseValue(text: string): number | null {
  const cleaned = text.trim().replace(/[,\s_]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** 복사에 쓸 값. 부동소수 잡음만 걷어낸 순수 숫자 문자열입니다. */
export function rawValue(v: number): string {
  if (!Number.isFinite(v)) return ''
  return String(Number(v.toPrecision(12)))
}

export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'

  const abs = Math.abs(v)
  if (abs >= 1e15 || abs < 1e-6) {
    const [mantissa, exponent] = v.toExponential(6).split('e')
    return `${Number(mantissa)}e${exponent}`
  }

  const rounded = Number(v.toPrecision(12))
  const [int, frac] = Math.abs(rounded).toString().split('.')
  const sign = rounded < 0 ? '-' : ''
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`
}
