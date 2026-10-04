// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptsText, dragDecision, INTERNAL_DRAG, useDocumentDrop } from './useDocumentDrop'

describe('dragDecision', () => {
  it.each([
    // [설명, types, 입력칸 위, 막기, 강조, 도구에 넘김]
    ['바깥 파일', ['Files'], false, true, true, true],
    ['바깥 파일을 입력칸 위에', ['Files'], true, true, true, true],
    ['페이지 안 그림(파일 실림)', [INTERNAL_DRAG, 'Files'], false, true, true, true],
    ['바깥 글자를 입력칸에', ['text/plain'], true, false, false, false],
    ['바깥 링크를 입력칸 밖에', ['text/uri-list'], false, true, false, true],
    ['페이지 안 글자를 입력칸에', [INTERNAL_DRAG, 'text/plain'], true, false, false, false],
    ['페이지 안 글자·링크를 입력칸 밖에', [INTERNAL_DRAG, 'text/uri-list'], false, true, false, false],
  ] as const)('%s', (_, types, intoField, prevent, highlight, deliver) => {
    expect(dragDecision(types, intoField)).toEqual({ prevent, highlight, deliver })
  })
})

describe('acceptsText', () => {
  const make = (html: string) => {
    document.body.innerHTML = html
    return document.body.querySelector('[data-target]') as HTMLElement
  }

  it.each([
    ['textarea', '<textarea data-target></textarea>', true],
    ['type 없는 input', '<input data-target>', true],
    ['검색 칸', '<input type="search" data-target>', true],
    ['체크박스(MUI 스위치 뒤의 input)', '<input type="checkbox" data-target>', false],
    ['파일 고르기', '<input type="file" data-target>', false],
    ['읽기 전용 textarea', '<textarea readonly data-target></textarea>', false],
    ['비활성 input', '<input disabled data-target>', false],
    ['contenteditable', '<div contenteditable="true" data-target></div>', true],
    ['textarea 안쪽이 아닌 일반 글', '<p data-target>글</p>', false],
  ])('%s', (_, html, expected) => {
    expect(acceptsText(make(html))).toBe(expected)
  })
})

describe('useDocumentDrop', () => {
  let root: ReturnType<typeof createRoot> | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    vi.useRealTimers()
  })

  function mount(onDrop: (data: DataTransfer | null) => void) {
    function Probe() {
      return <span data-dragging={String(useDocumentDrop(onDrop))} />
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<Probe />))
    return {
      get dragging() {
        return host.querySelector('span')?.dataset.dragging === 'true'
      },
    }
  }

  const fire = (type: string, types: string[], target: EventTarget = document) => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
    const data = { types, files: [] as File[], setData: (t: string) => types.push(t) }
    Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('바깥 파일: 강조하고, 놓으면 넘기고, dragover가 1초 끊기면 강조를 끈다', () => {
    vi.useFakeTimers()
    const onDrop = vi.fn()
    const seen = mount(onDrop)
    expect(fire('dragover', ['Files']).defaultPrevented).toBe(true)
    expect(seen.dragging).toBe(true)
    act(() => vi.advanceTimersByTime(1100))
    expect(seen.dragging).toBe(false)
    fire('dragover', ['Files'])
    expect(fire('drop', ['Files']).defaultPrevented).toBe(true)
    expect(seen.dragging).toBe(false)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('페이지 안에서 시작한 끌기는 dragstart에서 표식이 붙고, 입력칸 밖에 놓아도 도구에 넘기지 않는다', () => {
    const onDrop = vi.fn()
    mount(onDrop)
    const types = ['text/plain']
    fire('dragstart', types, document.body)
    expect(types).toContain(INTERNAL_DRAG)
    expect(fire('drop', types, document.body).defaultPrevented).toBe(true)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('입력칸에 놓는 글자는 막지 않는다', () => {
    const onDrop = vi.fn()
    mount(onDrop)
    const field = document.createElement('textarea')
    document.body.appendChild(field)
    expect(fire('dragover', ['text/plain'], field).defaultPrevented).toBe(false)
    expect(fire('drop', ['text/plain'], field).defaultPrevented).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('콜백이 바뀌어도 최신 콜백을 부른다', () => {
    const first = vi.fn()
    const second = vi.fn()
    let current = first
    function Probe() {
      useDocumentDrop((data) => current(data))
      return null
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<Probe />))
    current = second
    act(() => root!.render(<Probe />))
    fire('drop', ['Files'])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
