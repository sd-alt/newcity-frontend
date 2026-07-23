import * as Cesium from 'cesium'
import type { Viewer } from 'cesium'
import { ref } from 'vue'

export type MapToolMode = 'none' | 'measure-line' | 'measure-area' | 'draw-point' | 'draw-polygon' | 'box-select'

export const mapToolMode = ref<MapToolMode>('none')
export const mapToolMessage = ref('')
export const mapBoxSelectResult = ref<{ count: number; entityIds: string[] } | null>(null)

let handler: Cesium.ScreenSpaceEventHandler | null = null
let activeDs: Cesium.CustomDataSource | null = null
const positions: Cesium.Cartesian3[] = []

function ensureDs(viewer: Viewer): Cesium.CustomDataSource {
  if (activeDs) return activeDs
  activeDs = new Cesium.CustomDataSource('map-tools')
  void viewer.dataSources.add(activeDs)
  return activeDs
}

function clearHandler() {
  handler?.destroy()
  handler = null
}

function distMeters(a: Cesium.Cartesian3, b: Cesium.Cartesian3) {
  return Cesium.Cartesian3.distance(a, b)
}

function formatLen(m: number) {
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km'
  return m.toFixed(1) + ' m'
}

function polygonArea(cartesians: Cesium.Cartesian3[]) {
  if (cartesians.length < 3) return 0
  const geodes = cartesians.map((c) => {
    const c2 = Cesium.Cartographic.fromCartesian(c)
    return [Cesium.Math.toDegrees(c2.longitude), Cesium.Math.toDegrees(c2.latitude)] as [number, number]
  })
  const lat0 = geodes.reduce((s, p) => s + p[1], 0) / geodes.length
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  let area = 0
  for (let i = 0; i < geodes.length; i++) {
    const p1 = geodes[i]
    const p2 = geodes[(i + 1) % geodes.length]
    if (!p1 || !p2) continue
    const X1 = p1[0] * mPerDegLon
    const Y1 = p1[1] * mPerDegLat
    const X2 = p2[0] * mPerDegLon
    const Y2 = p2[1] * mPerDegLat
    area += X1 * Y2 - X2 * Y1
  }
  return Math.abs(area) / 2
}

function formatArea(m2: number) {
  if (m2 >= 1e6) return (m2 / 1e6).toFixed(3) + ' km²'
  return m2.toFixed(1) + ' m²'
}

function pickCartesian(viewer: Viewer, position: Cesium.Cartesian2): Cesium.Cartesian3 | null {
  const fromPick = viewer.scene.pickPosition(position)
  if (fromPick) return fromPick
  const fromEllipsoid = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
  return fromEllipsoid || null
}

export function clearMapDrawings(viewer: Viewer | null) {
  positions.length = 0
  if (activeDs && viewer && !viewer.isDestroyed()) {
    try {
      viewer.dataSources.remove(activeDs, true)
    } catch {
      /* ignore */
    }
  }
  activeDs = null
  mapToolMessage.value = ''
  mapToolMode.value = 'none'
  clearHandler()
}

export function setMapToolMode(viewer: Viewer | null, mode: MapToolMode) {
  if (!viewer || viewer.isDestroyed()) return
  clearHandler()
  positions.length = 0
  mapToolMode.value = mode
  if (mode === 'none') {
    mapToolMessage.value = ''
    return
  }
  const ds = ensureDs(viewer)
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

  if (mode === 'measure-line' || mode === 'draw-point') {
    mapToolMessage.value = mode === 'measure-line' ? '点击测距，双击结束' : '点击绘制点位'
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const cartesian = pickCartesian(viewer, movement.position)
      if (!cartesian) return
      if (mode === 'draw-point') {
        ds.entities.add({
          position: cartesian,
          point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        })
        mapToolMessage.value = '已添加点位'
        return
      }
      positions.push(cartesian)
      ds.entities.add({
        position: cartesian,
        point: { pixelSize: 8, color: Cesium.Color.YELLOW },
      })
      if (positions.length >= 2) {
        const a = positions[positions.length - 2]
        const b = positions[positions.length - 1]
        if (!a || !b) return
        const mid = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3())
        ds.entities.add({
          polyline: {
            positions: [a, b],
            width: 3,
            material: Cesium.Color.YELLOW,
            clampToGround: true,
          },
        })
        ds.entities.add({
          position: mid,
          label: {
            text: formatLen(distMeters(a, b)),
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        let total = 0
        for (let i = 1; i < positions.length; i++) {
          const p0 = positions[i - 1]
          const p1 = positions[i]
          if (p0 && p1) total += distMeters(p0, p1)
        }
        mapToolMessage.value = `累计距离 ${formatLen(total)}`
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(() => {
      mapToolMessage.value = (mapToolMessage.value || '') + ' · 已结束'
      mapToolMode.value = 'none'
      clearHandler()
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    return
  }

  mapToolMessage.value =
    mode === 'box-select' ? '点击两个角点完成框选' : '点击绘制多边形，双击结束'
  handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
    const cartesian = pickCartesian(viewer, movement.position)
    if (!cartesian) return
    positions.push(cartesian)
    ds.entities.add({
      position: cartesian,
      point: { pixelSize: 8, color: Cesium.Color.LIME },
    })
    if (mode === 'box-select' && positions.length >= 2) {
      const p0 = positions[0]
      const p1 = positions[1]
      if (!p0 || !p1) return
      const c1 = Cesium.Cartographic.fromCartesian(p0)
      const c2 = Cesium.Cartographic.fromCartesian(p1)
      const west = Math.min(c1.longitude, c2.longitude)
      const east = Math.max(c1.longitude, c2.longitude)
      const south = Math.min(c1.latitude, c2.latitude)
      const north = Math.max(c1.latitude, c2.latitude)
      ds.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromRadiansArray([west, south, east, south, east, north, west, north]),
          material: Cesium.Color.CYAN.withAlpha(0.2),
          outline: true,
          outlineColor: Cesium.Color.CYAN,
        },
      })
      const hitIds: string[] = []
      for (let di = 0; di < viewer.dataSources.length; di += 1) {
        const source = viewer.dataSources.get(di)
        if (!source || source.name === 'map-tools') continue
        for (const ent of source.entities.values) {
          const pos = ent.position?.getValue(viewer.clock.currentTime)
          if (!pos) continue
          const cart = Cesium.Cartographic.fromCartesian(pos)
          if (
            cart.longitude >= west &&
            cart.longitude <= east &&
            cart.latitude >= south &&
            cart.latitude <= north
          ) {
            hitIds.push(String(ent.id))
          }
        }
      }
      mapBoxSelectResult.value = { count: hitIds.length, entityIds: hitIds }
      mapToolMessage.value = hitIds.length ? `框选到 ${hitIds.length} 个要素` : '框选范围内无点状要素'
      mapToolMode.value = 'none'
      clearHandler()
      return
    }
    if (positions.length >= 2) {
      ds.entities.add({
        polyline: {
          positions: positions.slice(),
          width: 2,
          material: Cesium.Color.LIME,
          clampToGround: true,
        },
      })
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  handler.setInputAction(() => {
    if (positions.length >= 3) {
      ds.entities.add({
        polygon: {
          hierarchy: positions.slice(),
          material: Cesium.Color.LIME.withAlpha(0.25),
          outline: true,
          outlineColor: Cesium.Color.LIME,
        },
      })
      if (mode === 'measure-area') {
        mapToolMessage.value = `面积 ${formatArea(polygonArea(positions))}`
      } else {
        mapToolMessage.value = '多边形已绘制'
      }
    }
    mapToolMode.value = 'none'
    clearHandler()
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
}
