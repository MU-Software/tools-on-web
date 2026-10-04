import { useEffect, useEffectEvent, useState } from 'react'

// 이 페이지 안에서 시작한 끌기에 싣는 표식. 상태 없이 이벤트마다 페이지 안 끌기인지 가릴 수 있습니다.
export const INTERNAL_DRAG = 'application/x-tools-on-web-internal'

// dragover는 커서가 페이지 위에 있는 동안 350±200ms마다 오므로, 메인 스레드가 잠깐 바쁜 것까지 감안해 1초 넘게
// 끊기면 끌기가 떠난 것으로 봅니다.
const LEAVE_AFTER = 1000

// 글자를 받는 입력칸만 봅니다. MUI 스위치·체크박스 뒤의 숨은 input까지 넣으면 그 위에 놓은 링크로 페이지를 떠납니다.
const TEXT_INPUT = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="number"], input[type="tel"], input[type="password"]'

/** 놓으면 글자를 받아 주는 곳인지. 읽기 전용·비활성 칸은 받지 않아 브라우저 기본 동작(링크 열기)으로 넘어가므로 뺍니다. */
export function acceptsText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const field = target.closest<HTMLInputElement | HTMLTextAreaElement>(TEXT_INPUT)
  return field !== null && !field.readOnly && !field.disabled
}

/**
 * 끌기 이벤트 하나를 어떻게 다룰지 정합니다.
 * - 파일이 실려 있으면 어디서 시작했든 받습니다(페이지 안 그림도 파일을 싣습니다).
 * - 파일이 아닌 끌기(글자·링크)는 입력칸 위에서는 브라우저에 맡겨 글자가 들어가게 합니다.
 * - 그 밖에서는 막습니다. 막지 않으면 Firefox는 놓은 링크로 페이지를 떠납니다.
 *   이 중 바깥에서 온 것만 도구에 넘겨 안내를 띄우고, 페이지 안 끌기는 조용히 버립니다.
 */
export function dragDecision(types: readonly string[], intoTextField: boolean) {
  if (types.includes('Files')) return { prevent: true, highlight: true, deliver: true }
  if (intoTextField) return { prevent: false, highlight: false, deliver: false }
  // 강조는 파일을 받을 때만 합니다. 글자를 끌 때 "파일을 놓으라"는 표시가 뜨면 헷갈립니다.
  const external = !types.includes(INTERNAL_DRAG)
  return { prevent: true, highlight: false, deliver: external }
}

/** 페이지 어디에 놓아도 받도록 문서 단위로 끌어다 놓기를 듣고, 지금 끌고 있는지 돌려줍니다. */
export function useDocumentDrop(onDrop: (data: DataTransfer | null) => void): boolean {
  const [dragging, setDragging] = useState(false)
  const handleDrop = useEffectEvent(onDrop)

  useEffect(() => {
    const decide = (e: DragEvent) => dragDecision(e.dataTransfer?.types ?? [], acceptsText(e.target))
    let timer = 0
    const start = (e: DragEvent) => e.dataTransfer?.setData(INTERNAL_DRAG, '')
    const over = (e: DragEvent) => {
      const d = decide(e)
      if (d.prevent) e.preventDefault()
      if (!d.highlight) return
      setDragging(true)
      // 들어오고 나간 횟수로 세면 끌기 도중 사라진 요소의 dragleave가 빠져 표시가 남으므로, dragover가 끊기면 끕니다.
      clearTimeout(timer)
      timer = window.setTimeout(() => setDragging(false), LEAVE_AFTER)
    }
    const drop = (e: DragEvent) => {
      clearTimeout(timer)
      setDragging(false)
      const d = decide(e)
      if (d.prevent) e.preventDefault()
      if (d.deliver) handleDrop(e.dataTransfer)
    }
    // 다른 요소가 dragstart 전파를 막아도 표식을 실을 수 있게 캡처 단계에서 받습니다.
    document.addEventListener('dragstart', start, true)
    document.addEventListener('dragover', over)
    document.addEventListener('drop', drop)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('dragstart', start, true)
      document.removeEventListener('dragover', over)
      document.removeEventListener('drop', drop)
    }
  }, [])

  return dragging
}
