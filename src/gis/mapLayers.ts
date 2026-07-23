import * as Cesium from 'cesium'
import { wktToGeoJson } from './wkt'
import type { BasemapKey } from './mapConfig'
import { getMapConfigSync } from './mapConfig'

const COLORS = {
  sensors: Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.9),
  sensorsOffline: Cesium.Color.fromCssColorString('#94A3B8').withAlpha(0.85),
  sensorsFault: Cesium.Color.fromCssColorString('#EF4444').withAlpha(0.9),
  sensorsMaint: Cesium.Color.fromCssColorString('#F59E0B').withAlpha(0.9),
  data: Cesium.Color.fromCssColorString('#1677FF').withAlpha(0.85),
  dataWarn: Cesium.Color.fromCssColorString('#F59E0B').withAlpha(0.85),
  dataBad: Cesium.Color.fromCssColorString('#EF4444').withAlpha(0.85),
  tasks: Cesium.Color.fromCssColorString('#0F3D66').withAlpha(0.55),
  tasksActive: Cesium.Color.fromCssColorString('#1677FF').withAlpha(0.55),
  tasksDone: Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.45),
  tasksFail: Cesium.Color.fromCssColorString('#EF4444').withAlpha(0.5),
  targets: Cesium.Color.fromCssColorString('#7c3aed').withAlpha(0.7),
}

function sensorColor(status: unknown): Cesium.Color {
  const st = String(status || '').toLowerCase()
  if (st.includes('offline') || st.includes('离线') || st === 'down') return COLORS.sensorsOffline
  if (st.includes('fault') || st.includes('error') || st.includes('故障') || st.includes('fail')) return COLORS.sensorsFault
  if (st.includes('maint') || st.includes('维护') || st.includes('repair')) return COLORS.sensorsMaint
  return COLORS.sensors
}

function dataColor(quality: unknown): Cesium.Color {
  const q = String(quality || '').toLowerCase()
  if (q.includes('bad') || q.includes('fail') || q.includes('invalid') || q.includes('异常') || q.includes('reject')) {
    return COLORS.dataBad
  }
  if (q.includes('warn') || q.includes('warning') || q.includes('告警') || q.includes('可疑')) {
    return COLORS.dataWarn
  }
  return COLORS.data
}

function taskColor(status: unknown): Cesium.Color {
  const st = String(status || '').toLowerCase()
  if (st.includes('fail') || st.includes('error') || st.includes('失败') || st.includes('cancel')) return COLORS.tasksFail
  if (st.includes('done') || st.includes('complete') || st.includes('完成') || st.includes('closed') || st.includes('published')) {
    return COLORS.tasksDone
  }
  if (st.includes('run') || st.includes('active') || st.includes('submit') || st.includes('执行') || st.includes('进行') || st.includes('planning')) {
    return COLORS.tasksActive
  }
  return COLORS.tasks
}

function polygonCentroid(degrees: number[]): [number, number] | null {
  if (degrees.length < 6) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i + 1 < degrees.length; i += 2) {
    sx += degrees[i]!
    sy += degrees[i + 1]!
    n += 1
  }
  if (!n) return null
  return [sx / n, sy / n]
}

function addGeometryEntity(
  dataSource: Cesium.CustomDataSource,
  id: string,
  name: string,
  wkt: string,
  color: Cesium.Color,
  description: string,
) {
  const geometry = wktToGeoJson(wkt)
  if (!geometry) return

  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as [number, number]
    dataSource.entities.add({
      id,
      name,
      description,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 12,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: name,
        font: '12px "Microsoft YaHei", "PingFang SC", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0F3D66').withAlpha(0.65),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    })
    return
  }

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as number[][][]
    const outer = rings[0] || []
    const degrees: number[] = []
    for (const pt of outer) {
      const lon = pt[0]
      const lat = pt[1]
      if (lon == null || lat == null) continue
      degrees.push(lon, lat)
    }
    if (degrees.length < 6) return
    const center = polygonCentroid(degrees)
    dataSource.entities.add({
      id,
      name,
      description,
      position: center
        ? Cesium.Cartesian3.fromDegrees(center[0], center[1])
        : undefined,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(degrees),
        material: color.withAlpha(0.32),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        height: 0,
      },
      point: center
        ? {
            pixelSize: 10,
            color: color.withAlpha(0.95),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
      label: center
        ? {
            text: name,
            font: '12px "Microsoft YaHei", "PingFang SC", sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
    })
    return
  }

  if (geometry.type === 'LineString') {
    const line = geometry.coordinates as number[][]
    const degrees: number[] = []
    for (const pt of line) {
      const lon = pt[0]
      const lat = pt[1]
      if (lon == null || lat == null) continue
      degrees.push(lon, lat)
    }
    if (degrees.length < 4) return
    const mid = degrees.length >= 4
      ? ([degrees[Math.floor(degrees.length / 4) * 2]!, degrees[Math.floor(degrees.length / 4) * 2 + 1]! ] as [number, number])
      : null
    dataSource.entities.add({
      id,
      name,
      description,
      position: mid ? Cesium.Cartesian3.fromDegrees(mid[0], mid[1]) : undefined,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(degrees),
        width: 4,
        material: color,
        clampToGround: true,
      },
    })
  }
}

const FALLBACK_OSM = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  credit: 'OpenStreetMap',
  maxZoom: 19,
}

export function applyBasemap(viewer: Cesium.Viewer, key?: BasemapKey) {
  const cfg = getMapConfigSync()
  const basemapKey = key || cfg.defaultBasemap
  const bm = cfg.basemaps[basemapKey] || cfg.basemaps.vector || FALLBACK_OSM
  viewer.imageryLayers.removeAll()
  try {
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: bm.url,
        credit: bm.credit || '',
        maximumLevel: bm.maxZoom || 19,
      }),
    )
  } catch {
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: FALLBACK_OSM.url,
        credit: FALLBACK_OSM.credit,
        maximumLevel: FALLBACK_OSM.maxZoom,
      }),
    )
    return 'vector' as BasemapKey
  }
  return basemapKey
}

export function createViewer(container: HTMLElement, basemap?: BasemapKey): Cesium.Viewer {
  // 底图来自 /map-config.json，避免硬编码散落；无 Ion token 时不依赖 Cesium Ion
  const cfg = getMapConfigSync()
  const viewer = new Cesium.Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: true,
    terrain: undefined,
  })

  applyBasemap(viewer, basemap || cfg.defaultBasemap)

  viewer.scene.globe.depthTestAgainstTerrain = false
  const credit = viewer.cesiumWidget.creditContainer as HTMLElement
  credit.parentElement?.classList.add('cesium-credit-hide')

  const v = cfg.defaultView
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(v.lon, v.lat, v.height),
  })
  return viewer
}

export async function loadSensorLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
) {
  const ds = new Cesium.CustomDataSource('sensors')
  for (const item of features) {
    const id = String(item.platformId ?? item.id ?? Math.random())
    const name = String(item.platformName || item.name || id)
    const wkt = String(
      item.locationWkt ||
        (item.spatial as { positionWkt?: string } | undefined)?.positionWkt ||
        '',
    )
    const cap = (item.capabilitySummary || item.capability || {}) as {
      coverageWkts?: string[]
      coverageWkt?: string
    }
    const coverage = String(
      (item.spatial as { coverageWkt?: string } | undefined)?.coverageWkt ||
        cap.coverageWkt ||
        (Array.isArray(cap.coverageWkts) ? cap.coverageWkts[0] : '') ||
        '',
    )
    const status = item.status
    const color = sensorColor(status)
    const desc = [
      `类型: ${item.typeName || item.typeCode || '-'}`,
      `状态: ${status || '-'}`,
      `标识: ${item.platformIdentifier || '-'}`,
      `平台ID: ${id}`,
    ].join('<br/>')
    if (wkt) addGeometryEntity(ds, `sensor-${id}`, name, wkt, color, desc)
    if (coverage) {
      addGeometryEntity(ds, `sensor-cov-${id}`, `${name}-覆盖`, coverage, color.withAlpha(0.22), desc)
    }
  }
  await viewer.dataSources.add(ds)
  return ds
}

export async function loadDataLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
) {
  const ds = new Cesium.CustomDataSource('data')
  const points: Array<{ lon: number; lat: number }> = []

  for (const item of features) {
    const id = String(item.id ?? Math.random())
    const props = (item.properties || {}) as Record<string, unknown>
    const name = String(props.name || `数据 ${id}`)
    const wkt = String(item.geometryWkt || '')
    const quality = props.qualityStatus
    const color = dataColor(quality)
    const desc = [
      `类型: ${props.dataType || '-'}`,
      `格式: ${props.dataFormat || '-'}`,
      `质量: ${quality || '-'}`,
      `时间: ${props.observedAt || props.timeStart || '-'}`,
      `数据ID: ${id}`,
    ].join('<br/>')
    addGeometryEntity(ds, `data-${id}`, name, wkt, color, desc)

    // 收集点位，用于简易热力/聚合示意（Word C2/D4）
    const geometry = wktToGeoJson(wkt)
    if (geometry?.type === 'Point') {
      const [lon, lat] = geometry.coordinates as [number, number]
      if (Number.isFinite(lon) && Number.isFinite(lat)) points.push({ lon, lat })
    } else if (geometry?.type === 'LineString') {
      // 轨迹线已在 addGeometryEntity 中绘制
    }
  }

  // 0.05° 网格聚合热力圈
  const bins = new Map<string, { lon: number; lat: number; count: number }>()
  for (const p of points) {
    const key = `${(Math.floor(p.lon / 0.05) * 0.05).toFixed(2)},${(Math.floor(p.lat / 0.05) * 0.05).toFixed(2)}`
    const cur = bins.get(key)
    if (cur) cur.count += 1
    else bins.set(key, { lon: p.lon, lat: p.lat, count: 1 })
  }
  let bi = 0
  for (const bin of bins.values()) {
    if (bin.count < 1) continue
    const radius = Math.min(12000, 2500 + bin.count * 1500)
    const alpha = Math.min(0.55, 0.15 + bin.count * 0.08)
    ds.entities.add({
      id: `data-heat-${bi++}`,
      name: `热力聚合 x${bin.count}`,
      position: Cesium.Cartesian3.fromDegrees(bin.lon, bin.lat),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: COLORS.data.withAlpha(alpha),
        outline: false,
        height: 0,
      },
      description: `聚合点数: ${bin.count}`,
    })
  }

  await viewer.dataSources.add(ds)
  return ds
}

export async function loadTaskLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
) {
  const ds = new Cesium.CustomDataSource('tasks')
  for (const item of features) {
    const id = String(item.id ?? Math.random())
    const props = (item.properties || {}) as Record<string, unknown>
    const name = String(props.name || props.code || `任务 ${id}`)
    const wkt = String(item.geometryWkt || '')
    const status = props.status
    const color = taskColor(status)
    const desc = [
      `编码: ${props.code || '-'}`,
      `状态: ${status || '-'}`,
      `类型: ${props.taskType || '-'}`,
      `任务ID: ${id}`,
    ].join('<br/>')
    addGeometryEntity(ds, `task-${id}`, name, wkt, color, desc)

    const targets = (item.targets || []) as Array<Record<string, unknown>>
    for (const target of targets) {
      const tid = String(target.id ?? Math.random())
      const tprops = (target.properties || {}) as Record<string, unknown>
      const tname = String(tprops.name || `目标 ${tid}`)
      const twkt = String(target.geometryWkt || '')
      addGeometryEntity(
        ds,
        `target-${tid}`,
        tname,
        twkt,
        COLORS.targets,
        `任务: ${name}<br/>目标类型: ${tprops.targetType || '-'}`,
      )
    }
  }
  await viewer.dataSources.add(ds)
  return ds
}

export function flyToChina(viewer: Cesium.Viewer) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(114.3, 22.8, 800000),
    duration: 1.2,
  })
}

export async function flyToDataSources(viewer: Cesium.Viewer) {
  const all: Cesium.Entity[] = []
  for (let i = 0; i < viewer.dataSources.length; i += 1) {
    const ds = viewer.dataSources.get(i)
    if (!ds || ds.show === false) continue
    all.push(...ds.entities.values)
  }
  if (!all.length) {
    flyToChina(viewer)
    return
  }
  try {
    await viewer.flyTo(all, { duration: 1.2 })
  } catch {
    flyToChina(viewer)
  }
}


export async function loadWktFeatureLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
  options?: {
    idPrefix?: string
    name?: string
    color?: Cesium.Color
    getWkt?: (item: Record<string, unknown>) => string
    getName?: (item: Record<string, unknown>) => string
    getDescription?: (item: Record<string, unknown>) => string
  },
) {
  const prefix = options?.idPrefix || "feat"
  const dsName = options?.name || prefix
  const color = options?.color || Cesium.Color.fromCssColorString("#0f766e").withAlpha(0.8)
  const getWkt =
    options?.getWkt ||
    ((item: Record<string, unknown>) =>
      String(item.spatialWkt || item.geometryWkt || item.locationWkt || item.researchAreaWkt || ""))
  const getName =
    options?.getName ||
    ((item: Record<string, unknown>) =>
      String(item.displayName || item.name || item.code || item.id || prefix))
  const getDescription =
    options?.getDescription ||
    ((item: Record<string, unknown>) =>
      Object.entries(item)
        .filter(([k]) => !/wkt|geometry|payload/i.test(k))
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${String(v ?? "-")}`)
        .join("<br/>"))

  const ds = new Cesium.CustomDataSource(dsName)
  for (const item of features) {
    const id = String(item.id ?? Math.random())
    const wkt = getWkt(item)
    if (!wkt) continue
    addGeometryEntity(ds, `${prefix}-${id}`, getName(item), wkt, color, getDescription(item))
  }
  await viewer.dataSources.add(ds)
  return ds
}

/** 规划关联连线：候选/基础/优化/增补 */
export async function loadAssociationLinksLayer(
  viewer: Cesium.Viewer,
  links: Array<{
    id: string
    fromLon: number
    fromLat: number
    toLon: number
    toLat: number
    name?: string
    description?: string
    mode?: 'candidate' | 'basic' | 'optimized' | 'supplement'
    score?: number
  }>,
) {
  const ds = new Cesium.CustomDataSource('assoc-links')
  const modeColor: Record<string, Cesium.Color> = {
    candidate: Cesium.Color.fromCssColorString('#94A3B8').withAlpha(0.9),
    basic: Cesium.Color.fromCssColorString('#1677FF').withAlpha(0.95),
    optimized: Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.95),
    supplement: Cesium.Color.fromCssColorString('#F59E0B').withAlpha(0.95),
  }
  for (const link of links) {
    const color = modeColor[link.mode || 'candidate'] || modeColor.candidate
    const positions = Cesium.Cartesian3.fromDegreesArray([
      link.fromLon,
      link.fromLat,
      link.toLon,
      link.toLat,
    ])
    ds.entities.add({
      id: `assoc-link-${link.id}`,
      name: link.name || `关联 ${link.id}`,
      description:
        link.description ||
        `模式: ${link.mode || 'candidate'}<br/>评分: ${link.score ?? '-'}`,
      polyline: {
        positions,
        width: 3,
        material: color,
        clampToGround: true,
        arcType: Cesium.ArcType.GEODESIC,
      },
      position: Cesium.Cartesian3.fromDegrees(
        (link.fromLon + link.toLon) / 2,
        (link.fromLat + link.toLat) / 2,
      ),
      point: {
        pixelSize: 6,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }
  await viewer.dataSources.add(ds)
  return ds
}

