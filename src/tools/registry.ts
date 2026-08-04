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
    path: '/qr',
    icon: '🔳',
    title: 'UUID4 QR 생성기',
    desc: '랜덤 UUID v4를 QR 코드로 만들고 PNG로 저장합니다.',
    tags: ['QR', 'UUID', '오프라인'],
    component: lazy(() => import('./qr/QrGenerator')),
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
