import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VIEW_COLORS } from './colors'
import type { JobResult } from './repair.worker'

type Props = { result: JobResult; view: 'before' | 'after' }

function surface(position: THREE.BufferAttribute, tris: Uint32Array, filled?: Uint8Array) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', position)
  if (!filled) {
    geometry.setIndex(new THREE.BufferAttribute(tris, 1))
    return geometry
  }
  // 메운 면을 뒤로 모아 재질 두 개를 그룹으로 나눠 씁니다.
  const index = new Uint32Array(tris.length)
  let head = 0
  let tail = tris.length
  for (let t = 0; t < filled.length; t++) {
    const at = filled[t] ? (tail -= 3) : (head += 3) - 3
    index.set(tris.subarray(t * 3, t * 3 + 3), at)
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.addGroup(0, head, 0)
  geometry.addGroup(head, tris.length - head, 1)
  return geometry
}

function lines(position: THREE.BufferAttribute, pairs: Uint32Array, color: string) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setIndex(new THREE.BufferAttribute(pairs, 1))
  // WebGL 선은 1px로만 그려져서, 가려진 곳까지 비쳐 보이게 해야 문제 위치를 찾을 수 있습니다.
  const segments = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }))
  segments.renderOrder = 1
  return segments
}

const shaded = (color: string, side: THREE.Side) =>
  new THREE.MeshStandardMaterial({
    color,
    side,
    flatShading: true,
    roughness: 0.7,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.LineSegments)) return
    node.geometry.dispose()
    ;[node.material].flat().forEach((m: THREE.Material) => m.dispose())
  })
}

type Stage = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  render: () => void
  fitted: boolean
  before: THREE.Group | null
  after: THREE.Group | null
}

export default function StlViewer({ result, view }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)

  // 옵션을 바꿀 때마다 WebGL 컨텍스트를 새로 만들면 브라우저 한도에 걸리므로 렌더러는 하나만 둡니다.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // WebGL을 쓸 수 없는 환경(드라이버 차단, 원격 데스크톱, 컨텍스트 한도)에서도 수리 결과와 내려받기는 남깁니다.
      const note = document.createElement('p')
      note.textContent = '이 브라우저에서는 3D 미리보기를 띄울 수 없습니다 (WebGL 사용 불가)'
      note.style.cssText = 'margin:0;height:100%;display:grid;place-items:center;font-size:.875rem;opacity:.7;text-align:center;padding:16px'
      host.appendChild(note)
      return () => note.remove()
    }
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000)
    // STL은 대개 Z가 위입니다.
    camera.up.set(0, 0, 1)
    scene.add(camera)
    // 방향광은 target 쪽을 비추므로, target도 카메라에 달아 늘 보는 방향을 비추게 합니다.
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(1, 1.5, 2)
    key.target.position.set(0, 0, -1)
    camera.add(key, key.target)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50555f, 1.1))

    const controls = new OrbitControls(camera, renderer.domElement)
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      renderer.setSize(width, height, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    stageRef.current = { scene, camera, controls, render, fitted: false, before: null, after: null }
    return () => {
      stageRef.current = null
      observer.disconnect()
      controls.dispose()
      disposeTree(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const { before, after } = result
    const beforePosition = new THREE.BufferAttribute(before.verts, 3)
    const afterPosition = new THREE.BufferAttribute(after.verts, 3)
    const afterSurface = surface(afterPosition, after.tris, after.filled)
    const beforeSurface = surface(beforePosition, before.tris)
    const beforeGroup = new THREE.Group()
    beforeGroup.add(
      new THREE.Mesh(beforeSurface, shaded(VIEW_COLORS.surface, THREE.FrontSide)),
      new THREE.Mesh(beforeSurface, shaded(VIEW_COLORS.back, THREE.BackSide)),
      lines(beforePosition, before.boundaryLines, VIEW_COLORS.boundary),
      lines(beforePosition, before.nonManifoldLines, VIEW_COLORS.nonManifold),
    )
    const afterGroup = new THREE.Group()
    afterGroup.add(
      new THREE.Mesh(afterSurface, [
        shaded(VIEW_COLORS.surface, THREE.FrontSide),
        shaded(VIEW_COLORS.filled, THREE.FrontSide),
      ]),
      new THREE.Mesh(afterSurface, shaded(VIEW_COLORS.back, THREE.BackSide)),
    )
    stage.scene.add(beforeGroup, afterGroup)
    stage.before = beforeGroup
    stage.after = afterGroup

    // 부모가 파일마다 key를 달리해 새로 그리므로, 처음 한 번만 맞추고 옵션을 바꿔 다시 돌릴 때는 돌려 둔 시점을 둡니다.
    // 삼각형이 하나도 없으면 상자가 비어 카메라 좌표가 NaN이 되므로 맞추지 않습니다.
    const box = new THREE.Box3().setFromBufferAttribute(beforePosition)
    if (!stage.fitted && !box.isEmpty()) {
      const { camera, controls } = stage
      const center = box.getCenter(new THREE.Vector3())
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-6)
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05
      camera.position.copy(center).add(new THREE.Vector3(0.9, -1.3, 0.8).normalize().multiplyScalar(distance))
      camera.near = distance / 100
      camera.far = distance * 10
      camera.updateProjectionMatrix()
      camera.lookAt(center)
      // 원거리 평면 밖으로 물러나면 모델이 통째로 잘려 사라지므로 그 안에서만 줌아웃합니다.
      controls.maxDistance = distance * 5
      controls.minDistance = radius * 0.05
      controls.target.copy(center)
      controls.update()
      stage.fitted = true
    }

    return () => {
      stage.scene.remove(beforeGroup, afterGroup)
      disposeTree(beforeGroup)
      disposeTree(afterGroup)
      stage.before = null
      stage.after = null
    }
  }, [result])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage?.before || !stage.after) return
    stage.before.visible = view === 'before'
    stage.after.visible = view === 'after'
    stage.render()
  }, [view, result])

  return (
    <Box
      ref={hostRef}
      sx={{ height: { xs: 320, sm: 440 }, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover', cursor: 'grab' }}
    />
  )
}
