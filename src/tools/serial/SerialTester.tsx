import { useState } from 'react'
import { Alert, Box, Tab, Tabs } from '@mui/material'
import { EspFlasher } from './components/EspFlasher'
import { EspUsb } from './components/EspUsb'
import { BoardControl } from './components/BoardControl'

type TabKey = 'flasher' | 'control' | 'usb'

export default function SerialTester() {
  const [tab, setTab] = useState<TabKey>('flasher')

  const supportsSerial = typeof navigator !== 'undefined' && 'serial' in navigator
  const supportsUsb = typeof navigator !== 'undefined' && 'usb' in navigator
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v: TabKey) => setTab(v)}
        sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}
      >
        <Tab value="flasher" label="WebSerial 플래셔" />
        <Tab value="control" label="보드 제어" />
        <Tab value="usb" label="WebUSB 디버그" />
      </Tabs>

      {!supportsSerial && tab === 'flasher' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          현재 브라우저는 WebSerial을 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.
        </Alert>
      )}
      {!supportsUsb && (tab === 'usb' || tab === 'control') && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          현재 브라우저는 WebUSB를 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.
          (HTTP 전송은 WebUSB 없이도 사용할 수 있습니다.)
        </Alert>
      )}
      {isHttps && tab === 'control' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          이 페이지는 HTTPS로 제공되므로 보드로 향하는 http:// · ws:// 요청이 혼합 콘텐츠로
          차단됩니다. 사이트 설정에서 &quot;안전하지 않은 콘텐츠&quot;를 허용하고, 로컬 네트워크
          접근(LNA) 권한을 수동으로 허용해야 합니다.
        </Alert>
      )}

      {tab === 'flasher' && <EspFlasher />}
      {tab === 'control' && <BoardControl />}
      {tab === 'usb' && <EspUsb />}
    </Box>
  )
}
