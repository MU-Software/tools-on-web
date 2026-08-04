// WebUSB 인터페이스 선택/claim 공통 로직.
//
// ESP32-S3의 내장 USB-Serial-JTAG(0x303A:0x1001) 같은 CDC 복합 장치는 아예 거부한다.
// 인터페이스 0/1이 CDC(통신/데이터)라 호스트 OS의 시리얼 드라이버(macOS AppleUSBACM 등)가
// 점유하고 있어 claim이 실패하고, 남은 vendor 인터페이스는 JTAG이라 claim에 성공해도
// 시리얼 데이터가 흐르지 않는다. 즉 WebUSB로는 이 장치의 시리얼 경로에 닿을 수 없다.
//
// 이 프로젝트에서 WebUSB를 쓰는 장치(0x303A:0x4001)는 그래서 CDC가 없는 vendor 전용
// 펌웨어로 따로 만들어졌다. 자세한 배경은 board_serial_tester의 usb_iface.c 주석 참고.

export type UsbEndpoints = {
  interfaceNumber: number
  alternate: number
  inEndpoint: number | null
  outEndpoint: number | null
  packetSize: number
}

export type ClaimAttemptFailure = {
  interfaceNumber: number
  error: Error
}

const USB_CLASS_COMM = 0x02
const USB_CLASS_CDC_DATA = 0x0a
const USB_CLASS_VENDOR = 0xff

/** CDC(통신/데이터) 인터페이스를 노출하는 장치인지 — 즉 OS 시리얼 드라이버의 관할인지. */
export function cdcInterfaceNumbers(device: USBDevice): number[] {
  const config = device.configuration
  if (!config) return []
  return config.interfaces
    .filter((iface) =>
      iface.alternates.some(
        (alt) =>
          alt.interfaceClass === USB_CLASS_COMM || alt.interfaceClass === USB_CLASS_CDC_DATA,
      ),
    )
    .map((iface) => iface.interfaceNumber)
}

/**
 * claim 가능성이 높은 순서로 후보 인터페이스를 나열한다.
 * vendor-specific(0xFF) → 기타 → CDC(0x02/0x0A) 순이며, 같은 등급 안에서는
 * 양방향 bulk를 가진 쪽을 앞세운다.
 */
export function candidateInterfaces(device: USBDevice): UsbEndpoints[] {
  const config = device.configuration
  if (!config) return []
  const candidates: Array<{ rank: number; ep: UsbEndpoints }> = []
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      let inEp: number | null = null
      let outEp: number | null = null
      let pkt = 64
      for (const ep of alt.endpoints) {
        if (ep.type !== 'bulk' && ep.type !== 'interrupt') continue
        if (ep.direction === 'in' && inEp === null) inEp = ep.endpointNumber
        if (ep.direction === 'out' && outEp === null) outEp = ep.endpointNumber
        if (ep.packetSize) pkt = ep.packetSize
      }
      if (inEp === null && outEp === null) continue
      const cls = alt.interfaceClass
      const isCdc = cls === USB_CLASS_COMM || cls === USB_CLASS_CDC_DATA
      // 낮을수록 우선.
      const rank =
        (isCdc ? 100 : cls === USB_CLASS_VENDOR ? 0 : 10) +
        (inEp !== null && outEp !== null ? 0 : 5)
      candidates.push({
        rank,
        ep: {
          interfaceNumber: iface.interfaceNumber,
          alternate: alt.alternateSetting,
          inEndpoint: inEp,
          outEndpoint: outEp,
          packetSize: pkt,
        },
      })
    }
  }
  return candidates
    .sort((a, b) => a.rank - b.rank || a.ep.interfaceNumber - b.ep.interfaceNumber)
    .map((c) => c.ep)
}

/**
 * 후보 인터페이스를 우선순위대로 claim 시도하고, 처음 성공한 것을 반환한다.
 * 개별 실패는 `onAttemptFail`로 알리고 다음 후보로 넘어간다.
 * 호출자는 성공 시 반환된 `interfaceNumber`를 release할 책임이 있다.
 *
 * CDC 복합 장치는 claim을 시도하지 않고 바로 거부한다 — 파일 상단 주석 참고.
 */
export async function claimFirstUsableInterface(
  device: USBDevice,
  onAttemptFail?: (failure: ClaimAttemptFailure) => void,
): Promise<UsbEndpoints> {
  const cdc = cdcInterfaceNumbers(device)
  if (cdc.length > 0) {
    throw new Error(
      `이 장치는 CDC 복합 장치입니다 (interface ${cdc.join(', ')}). ` +
        '시리얼 데이터 경로는 OS 시리얼 드라이버가 점유하므로 WebUSB로는 접근할 수 없고, ' +
        '남은 vendor 인터페이스는 JTAG이라 열어도 시리얼 데이터가 흐르지 않습니다. ' +
        'Web Serial을 사용하세요.',
    )
  }

  const candidates = candidateInterfaces(device)
  if (candidates.length === 0) {
    throw new Error('사용 가능한 bulk/interrupt 엔드포인트를 찾지 못했습니다.')
  }

  let lastErr: Error | null = null
  for (const candidate of candidates) {
    try {
      await device.claimInterface(candidate.interfaceNumber)
    } catch (err) {
      lastErr = err as Error
      onAttemptFail?.({ interfaceNumber: candidate.interfaceNumber, error: lastErr })
      continue
    }
    try {
      if (candidate.alternate !== 0) {
        await device.selectAlternateInterface(candidate.interfaceNumber, candidate.alternate)
      }
      return candidate
    } catch (err) {
      lastErr = err as Error
      await device.releaseInterface(candidate.interfaceNumber).catch(() => {})
      onAttemptFail?.({ interfaceNumber: candidate.interfaceNumber, error: lastErr })
    }
  }

  throw new Error(
    'claim 가능한 인터페이스가 없습니다. 다른 탭이나 프로그램이 이미 이 장치를 열고 있는지 ' +
      `확인하세요. 원인: ${lastErr?.message ?? 'unknown'}`,
  )
}
