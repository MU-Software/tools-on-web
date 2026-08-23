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
    path: '/serial',
    icon: '🔌',
    title: 'Serial Tester',
    desc: 'ESP32-S3 보드를 WebSerial로 플래싱하고 WebUSB/HTTP로 제어합니다.',
    tags: ['ESP32', 'WebSerial', 'WebUSB'],
    // esptool-js를 끌고 오므로 lazy 유지
    component: lazy(() => import('./serial/SerialTester')),
  },
]
