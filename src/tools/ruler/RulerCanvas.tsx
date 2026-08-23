import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Box } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { drawRuler, placeRuler, projectToRuler, type Axis, type RulerTheme } from './draw'

type Props = {
  axis: Axis
  pxPerMm: number
  dpr: number
  thickness: number
  marker: number | null
  onMarker: (position: number) => void
}

export function RulerCanvas({ axis, pxPerMm, dpr, thickness, marker, onMarker }: Props) {
  const theme = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect
      setBox({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const palette = useMemo<RulerTheme>(
    () => ({
      face: theme.palette.mode === 'light' ? '#fffdf4' : '#10141d',
      ink: theme.palette.text.primary,
      sub: theme.palette.text.secondary,
      accent: theme.palette.primary.main,
      onAccent: theme.palette.primary.contrastText,
    }),
    [theme],
  )

  const placement = useMemo(
    () => placeRuler(axis, box.width, box.height, thickness),
    [axis, box.width, box.height, thickness],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || box.width <= 0 || box.height <= 0) return
    drawRuler(canvas, {
      axis,
      placement,
      pxPerMm,
      boxWidth: box.width,
      boxHeight: box.height,
      thickness,
      dpr,
      marker,
      theme: palette,
    })
  }, [axis, placement, pxPerMm, box, thickness, dpr, marker, palette])

  const track = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onMarker(projectToRuler(placement, e.clientX - rect.left, e.clientY - rect.top))
  }

  return (
    <Box
      ref={wrapRef}
      sx={{
        width: axis === 'v' ? thickness : '100%',
        height: axis === 'h' ? thickness : '100%',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="화면 자"
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          track(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons) track(e)
        }}
      />
    </Box>
  )
}
