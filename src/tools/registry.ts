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
]
