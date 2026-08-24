import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export type Tool = {
  path: string
  icon: string
  title: string
  desc: string
  tags: string[]
  component: LazyExoticComponent<ComponentType>
}

/** 여기에 항목을 추가하면 홈 카드와 라우팅이 함께 생성됩니다. */
export const TOOLS: Tool[] = [
  {
    path: '/barcode',
    icon: '🏷️',
    title: '바코드 생성기',
    desc: '임의의 문자열을 QR·Data Matrix·Code 128·EAN-13 등으로 만듭니다.',
    tags: ['바코드', 'QR', 'UUID', '오프라인'],
    // bwip-js를 끌고 오므로 lazy 유지
    component: lazy(() => import('./barcode/BarcodeGenerator')),
  },
  {
    path: '/qr-reader',
    icon: '🔎',
    title: 'QR 리더',
    desc: '사진·스크린샷이나 카메라로 QR·바코드를 zxing-wasm으로 읽습니다.',
    tags: ['QR', '바코드', '카메라', 'WebAssembly'],
    // zxing-wasm을 끌고 오므로 lazy 유지
    component: lazy(() => import('./qr/QrReader')),
  },
  {
    path: '/serial',
    icon: '🔌',
    title: 'Serial Tester',
    desc: 'ESP32-S3 보드를 WebSerial로 플래싱하고 WebUSB/HTTP로 제어합니다.',
    tags: ['ESP32', 'WebSerial', 'WebUSB'],
    // esptool-js를 끌고 오므로 lazy 유지
    component: lazy(() => import('./serial/SerialTester')),
  },
  {
    path: '/ruler',
    icon: '📏',
    title: '화면 자',
    desc: '장치를 추정해 화면 밀도를 잡고, 실제 크기의 자를 가로·세로·대각선으로 그립니다.',
    tags: ['자', 'DPI', 'PPI', '길이', '보정', '측정'],
    component: lazy(() => import('./ruler/ScreenRuler')),
  },
  {
    path: '/unit',
    icon: '📐',
    title: '단위 변환기',
    desc: '길이·무게·온도·데이터 등 15개 계열을 같은 계열의 모든 단위로 한 번에 환산합니다.',
    tags: ['단위', '변환', '길이', '무게', '온도', '오프라인'],
    component: lazy(() => import('./unit/UnitConverter')),
  },
  {
    path: '/timezone',
    icon: '🌏',
    title: '시간대 변환기',
    desc: '기준 시각 하나를 여러 시간대에 동시에 펼쳐 보고, 시차와 날짜 차이를 확인합니다.',
    tags: ['시간대', 'IANA', '시차', 'UTC', '서머타임'],
    component: lazy(() => import('./timezone/TimezoneConverter')),
  },
  {
    path: '/unix-time',
    icon: '⏱️',
    title: '유닉스 시간',
    desc: '현재 유닉스 시간을 실시간으로 보여주고, 초·밀리초·나노초 타임스탬프를 날짜로 풉니다.',
    tags: ['유닉스', '타임스탬프', 'epoch', 'ISO 8601'],
    component: lazy(() => import('./unixtime/UnixTime')),
  },
]
