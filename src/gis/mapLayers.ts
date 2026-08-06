import * as Cesium from 'cesium'
import { wktToGeoJson } from './wkt'
import type { BasemapKey } from './mapConfig'
import { getMapConfigSync } from './mapConfig'
import {
  createMapMarkerDataUri,
  platformMapSymbol,
  type MapSymbolKind,
} from './mapSymbols'

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

function colorHex(color: Cesium.Color): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`
}

function markerBillboard(
  kind: MapSymbolKind,
  color: Cesium.Color,
  heightReference: Cesium.HeightReference = Cesium.HeightReference.CLAMP_TO_GROUND,
) {
  return {
    image: createMapMarkerDataUri(kind, colorHex(color)),
    width: 30,
    height: 30,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    heightReference,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  }
}

const clusterMarkerCache = new Map<string, HTMLCanvasElement>()

function clusterMarkerCanvas(count: number, color: string) {
  const label = count > 99 ? '99+' : String(count)
  const cacheKey = `${label}:${color}`
  const cached = clusterMarkerCache.get(cacheKey)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.scale(2, 2)
  context.beginPath()
  context.arc(18, 18, 16, 0, Math.PI * 2)
  context.fillStyle = 'rgba(255,255,255,0.96)'
  context.fill()
  context.strokeStyle = '#CBD5E1'
  context.lineWidth = 1
  context.stroke()
  context.beginPath()
  context.arc(18, 18, 12.5, 0, Math.PI * 2)
  context.fillStyle = color
  context.fill()
  context.fillStyle = '#FFFFFF'
  context.font = `700 ${label.length > 2 ? 9 : 11}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, 18, 18.5)
  clusterMarkerCache.set(cacheKey, canvas)
  return canvas
}

function enablePointClustering(
  dataSource: Cesium.CustomDataSource,
  color: string,
  pixelOffsetX = 0,
) {
  const clustering = dataSource.clustering
  clustering.enabled = true
  clustering.pixelRange = 38
  clustering.minimumClusterSize = 2
  clustering.clusterBillboards = true
  clustering.clusterPoints = true
  clustering.clusterLabels = false
  clustering.clusterEvent.addEventListener((entities, cluster) => {
    cluster.point.show = false
    cluster.label.show = false
    cluster.billboard.show = true
    cluster.billboard.id = entities
    cluster.billboard.setImage(
      `cluster-${entities.length > 99 ? '99+' : entities.length}-${color}`,
      clusterMarkerCanvas(entities.length, color),
    )
    cluster.billboard.width = 36
    cluster.billboard.height = 36
    cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER
    cluster.billboard.pixelOffset = new Cesium.Cartesian2(pixelOffsetX, 0)
    cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY
  })
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

// 高空视角隐藏文字标签，避免默认视图下标签堆叠成团；拉近后自动显示
const LABEL_DISTANCE = () => new Cesium.DistanceDisplayCondition(0, 60000)

const satelliteLabelVisibility = new WeakMap<Cesium.Entity, boolean>()

function entityPropertyValue(entity: Cesium.Entity, key: string, time: Cesium.JulianDate) {
  try {
    const properties = entity.properties?.getValue(time) as Record<string, unknown> | undefined
    return properties?.[key]
  } catch {
    return undefined
  }
}

/** 让卫星名称跟随当前视口；同时保持广告牌可点选。 */
export function updateSatelliteViewVisibility(viewer: Cesium.Viewer) {
  if (!viewer || viewer.isDestroyed()) return
  const sensors = viewer.dataSources.getByName('sensors')[0]
  if (!sensors || !sensors.show) return
  const canvas = viewer.scene.canvas
  const time = viewer.clock.currentTime
  let changed = false
  for (const entity of sensors.entities.values) {
    if (entityPropertyValue(entity, 'mapKind', time) !== 'satellite' || !entity.label) continue
    const position = entity.position?.getValue(time)
    let visible = false
    if (position) {
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        position,
        new Cesium.Cartesian2(),
      )
      visible = Boolean(
        screen &&
          Number.isFinite(screen.x) &&
          Number.isFinite(screen.y) &&
          screen.x >= -24 &&
          screen.y >= -24 &&
          screen.x <= canvas.clientWidth + 24 &&
          screen.y <= canvas.clientHeight + 24,
      )
    }
    if (satelliteLabelVisibility.get(entity) === visible) continue
    entity.label.show = new Cesium.ConstantProperty(visible)
    satelliteLabelVisibility.set(entity, visible)
    changed = true
  }
  if (changed) viewer.scene.requestRender()
}

function addGeometryEntity(
  dataSource: Cesium.CustomDataSource,
  id: string,
  name: string,
  wkt: string,
  color: Cesium.Color,
  description: string,
  options?: {
    quiet?: boolean
    markerKind?: MapSymbolKind
    polygonAlpha?: number
    fitGroup?: 'ground' | 'space'
  },
) {
  const geometry = wktToGeoJson(wkt)
  if (!geometry) return
  const quiet = options?.quiet === true
  const markerKind = options?.markerKind

  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as [number, number]
    dataSource.entities.add({
      id,
      name,
      description,
      properties: {
        ...(options?.fitGroup ? { fitGroup: options.fitGroup } : {}),
        ...(markerKind ? { mapKind: markerKind } : {}),
      },
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: markerKind ? markerBillboard(markerKind, color) : undefined,
      point: markerKind
        ? undefined
        : {
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
        distanceDisplayCondition: LABEL_DISTANCE(),
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
      properties: {
        ...(options?.fitGroup ? { fitGroup: options.fitGroup } : {}),
        ...(markerKind ? { mapKind: markerKind } : {}),
      },
      position: center
        ? Cesium.Cartesian3.fromDegrees(center[0], center[1])
        : undefined,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(degrees),
        material: color.withAlpha(options?.polygonAlpha ?? Math.min(color.alpha, 0.18)),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        height: 0,
      },
      label: center && !quiet
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
            distanceDisplayCondition: LABEL_DISTANCE(),
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
  // 底图来自 /map-config.json，避免硬编码散落；无 Ion 令牌时不依赖 Cesium Ion。
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
    selectionIndicator: false,
    terrain: undefined,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
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

type SatelliteTrajectoryPoint = {
  time: string
  longitude: number
  latitude: number
  altitudeKm?: number
  altitudeM?: number
}

type DynamicTrajectory = {
  current: SatelliteTrajectoryPoint
  position: Cesium.SampledPositionProperty
  startMs: number
  stopMs: number
  dataKind: string
}

function addDynamicTrajectory(
  dataSource: Cesium.CustomDataSource,
  id: string,
  name: string,
  item: Record<string, unknown>,
  color: Cesium.Color,
  description: string,
  markerKind: MapSymbolKind,
): DynamicTrajectory | null {
  const trajectory = (item.trajectory || {}) as {
    available?: boolean
    source?: string
    tleVersion?: number
    generatedAt?: string
    dataKind?: string
    points?: SatelliteTrajectoryPoint[]
  }
  const points = (trajectory.points || [])
    .filter((point) =>
      Number.isFinite(Number(point.longitude)) &&
      Number.isFinite(Number(point.latitude)) &&
      Number.isFinite(Date.parse(String(point.time))),
    )
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  if (!trajectory.available || points.length < 1) return null
  const isSatellite = markerKind === 'satellite'
  const dataKind = String(trajectory.dataKind || (isSatellite ? 'tle-sgp4' : 'position-telemetry'))
  const trajectoryColor = isSatellite
    ? Cesium.Color.fromCssColorString('#38BDF8')
    : markerKind === 'uav'
      ? Cesium.Color.fromCssColorString('#14B8A6')
      : color
  const trajectoryLabel = isSatellite
    ? 'TLE/SGP4 准实时轨道预测'
    : dataKind === 'demo-telemetry'
      ? '演示数据'
      : dataKind === 'position-telemetry'
        ? '实际位置遥测'
        : markerKind === 'uav'
          ? '飞行轨迹'
          : '移动轨迹'
  const altitudeMeters = (point: SatelliteTrajectoryPoint) =>
    Number.isFinite(Number(point.altitudeKm))
      ? Number(point.altitudeKm) * 1000
      : Number(point.altitudeM || 0)

  const startMs = Date.parse(points[0]!.time)
  const stopMs = Date.parse(points[points.length - 1]!.time)
  const position = new Cesium.SampledPositionProperty()
  position.setInterpolationOptions({
    // Cesium's runtime LinearApproximation is linear; its bundled declaration is narrower than the runtime object.
    interpolationAlgorithm: Cesium.LinearApproximation as unknown as Cesium.InterpolationAlgorithm,
    interpolationDegree: 1,
  })
  for (const point of points) {
    position.addSample(
      Cesium.JulianDate.fromDate(new Date(point.time)),
      Cesium.Cartesian3.fromDegrees(
        Number(point.longitude),
        Number(point.latitude),
        altitudeMeters(point),
      ),
    )
  }

  const segments: SatelliteTrajectoryPoint[][] = [[]]
  for (const point of points) {
    const currentSegment = segments[segments.length - 1]!
    const previous = currentSegment[currentSegment.length - 1]
    if (previous && Math.abs(Number(point.longitude) - Number(previous.longitude)) > 180) {
      segments.push([])
    }
    segments[segments.length - 1]!.push(point)
  }
  const nowMs = Date.now()
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.length < 2) continue
    const phases: Array<{ points: SatelliteTrajectoryPoint[]; future: boolean }> = [
      { points: [], future: false },
    ]
    for (const point of segment) {
      const future = Date.parse(point.time) > nowMs
      const currentPhase = phases[phases.length - 1]!
      if (currentPhase.points.length && currentPhase.future !== future) {
        phases.push({ points: [], future })
      }
      const target = phases[phases.length - 1]!
      target.future = future
      target.points.push(point)
    }
    for (const [phaseIndex, phase] of phases.entries()) {
      if (phase.points.length < 2) continue
      dataSource.entities.add({
        id: `sensor-track-${id}-${segmentIndex}-${phaseIndex}`,
        name: `${name} ${trajectoryLabel}`,
        description: `${description}<br/>轨迹含义: ${trajectoryLabel}${phase.future ? ' · 未来预测' : ' · 历史轨迹'}`,
        properties: {
          fitGroup: isSatellite ? 'space' : 'ground',
          mapKind: markerKind,
          sensorId: id,
          dataKind,
          clockTrack: isSatellite && stopMs > startMs,
          trajectoryStartMs: startMs,
          trajectoryStopMs: stopMs,
        },
        polyline: {
          positions: phase.points.map((point) =>
            Cesium.Cartesian3.fromDegrees(
              Number(point.longitude),
              Number(point.latitude),
              altitudeMeters(point),
            ),
          ),
          width: isSatellite ? 3 : 4,
          material: phase.future
            ? new Cesium.PolylineDashMaterialProperty({
                color: trajectoryColor.withAlpha(isSatellite ? 0.45 : 0.55),
                dashLength: 14,
              })
            : new Cesium.PolylineGlowMaterialProperty({
                color: trajectoryColor.withAlpha(0.92),
                glowPower: isSatellite ? 0.18 : 0.12,
              }),
          clampToGround: false,
          arcType: Cesium.ArcType.NONE,
        },
      })
    }
  }

  const now = Date.now()
  const current = points.reduce((best, point) =>
    Math.abs(Date.parse(point.time) - now) < Math.abs(Date.parse(best.time) - now)
      ? point
      : best,
  )
  const currentDescription = [
    description,
    `位置来源: ${trajectory.source || '位置轨迹接口'}`,
    trajectory.tleVersion != null ? `TLE版本: ${trajectory.tleVersion}` : '',
    Number.isFinite(Number(current.altitudeKm))
      ? `轨道高度: ${Number(current.altitudeKm).toFixed(1)} km`
      : Number.isFinite(Number(current.altitudeM))
        ? `当前高度: ${Number(current.altitudeM).toFixed(1)} m`
        : '',
    `位置时刻: ${new Date(current.time).toLocaleString('zh-CN')}`,
    trajectory.generatedAt
      ? `轨迹生成: ${new Date(trajectory.generatedAt).toLocaleString('zh-CN')}`
      : '',
  ].filter(Boolean).join('<br/>')
  dataSource.entities.add({
    id: `sensor-${id}`,
    name,
    description: currentDescription,
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({
        start: Cesium.JulianDate.fromDate(new Date(startMs)),
        stop: Cesium.JulianDate.fromDate(new Date(stopMs)),
      }),
    ]),
    properties: {
      fitGroup: isSatellite ? 'space' : 'ground',
      mapKind: markerKind,
      sensorId: id,
      dataKind,
      clockTrack: isSatellite && stopMs > startMs,
      trajectoryStartMs: startMs,
      trajectoryStopMs: stopMs,
    },
    position,
    billboard: markerBillboard(markerKind, color, Cesium.HeightReference.NONE),
    label: {
      show: true,
      text: `${name} · ${trajectoryLabel}`,
      font: '12px "Microsoft YaHei", "PingFang SC", sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: trajectoryColor.withAlpha(0.78),
      backgroundPadding: new Cesium.Cartesian2(7, 4),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
        0,
        isSatellite ? 30000000 : 600000,
      ),
    },
  })
  return { current, position, startMs, stopMs, dataKind }
}

function addSatelliteFootprintEntity(
  dataSource: Cesium.CustomDataSource,
  id: string,
  name: string,
  track: DynamicTrajectory,
  item: Record<string, unknown>,
  color: Cesium.Color,
  description: string,
) {
  const typeSummary = (item.typeSummary || {}) as Record<string, unknown>
  const swathKm = Number(typeSummary.swathKm)
  if (!Number.isFinite(swathKm) || swathKm <= 0) return false
  const radiusMeters = (swathKm * 1000) / 2
  const groundPosition = new Cesium.CallbackPositionProperty((time) => {
    const position = track.position.getValue(time)
    if (!position) return undefined
    const cartographic = Cesium.Cartographic.fromCartesian(position)
    return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0)
  }, false)
  dataSource.entities.add({
    id: `sensor-footprint-${id}`,
    name: `${name}-预测幅宽覆盖（近似）`,
    description: [
      description,
      `预测幅宽覆盖（近似）: 轨迹地面投影 · 幅宽 ${swathKm.toFixed(1)} km`,
      '不代表当前真实观测范围',
    ].join('<br/>'),
    properties: {
      fitGroup: 'ground',
      mapKind: 'satelliteCoverage',
      sensorId: id,
    },
    position: groundPosition,
    ellipse: {
      semiMajorAxis: radiusMeters,
      semiMinorAxis: radiusMeters,
      height: 0,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      material: Cesium.Color.fromCssColorString('#38BDF8').withAlpha(0.14),
      outline: true,
      outlineColor: color.withAlpha(0.82),
      outlineWidth: 2,
    },
  })
  return true
}

export async function loadSensorLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
) {
  const ds = new Cesium.CustomDataSource('sensors')
  for (const item of features) {
    const id = String(item.platformId ?? item.id ?? Math.random())
    const name = String(item.platformName || item.name || id)
    const typeCode = String(item.typeCode || '')
    const spatial = (item.spatial || {}) as {
      positionWkt?: string
      trackWkt?: string
      coverageWkt?: string
    }
    const wkt = String(
      item.locationWkt ||
        spatial.positionWkt ||
        '',
    )
    const track = String(spatial.trackWkt || '')
    const cap = (item.capabilitySummary || item.capability || {}) as {
      coverageWkts?: string[]
      coverageWkt?: string
    }
    const coverage = String(
      spatial.coverageWkt ||
        cap.coverageWkt ||
        (Array.isArray(cap.coverageWkts) ? cap.coverageWkts[0] : '') ||
        '',
    )
    const status = item.status
    const color = sensorColor(status)
    const markerKind = platformMapSymbol(typeCode)
    const trajectory = (item.trajectory || {}) as {
      available?: boolean
      source?: string
      message?: string
      points?: unknown[]
    }
    const typeSummary = (item.typeSummary || {}) as Record<string, unknown>
    const swathKm = Number(typeSummary.swathKm)
    const trajectoryStatus = trajectory.available
      ? `轨迹: 已加载 ${Array.isArray(trajectory.points) ? trajectory.points.length : 0} 个位置点 · ${trajectory.source || '轨迹接口'}`
      : typeCode === 'satellite'
        ? `轨迹: ${trajectory.message || '缺少活动 TLE，仅显示登记位置'}`
        : typeCode === 'uav'
          ? '轨迹: 暂无位置遥测，仅显示登记位置'
          : ''
    const desc = [
      `类型: ${item.typeName || item.typeCode || '-'}`,
      `状态: ${status || '-'}`,
      `标识: ${item.platformIdentifier || '-'}`,
      `平台ID: ${id}`,
      wkt ? '位置: 已加载' : '',
      coverage ? '覆盖范围: 已加载' : '',
      trajectoryStatus,
      typeCode === 'satellite' && !coverage && Number.isFinite(swathKm) && swathKm > 0
        ? `扫描范围: 按当前轨迹计算 · ${swathKm.toFixed(1)} km`
        : typeCode === 'satellite' && !coverage
          ? '扫描范围: 未配置有效观测幅宽'
          : '',
    ]
      .filter(Boolean)
      .join('<br/>')
    if (typeCode === 'satellite') {
      const dynamicTrack = addDynamicTrajectory(ds, id, name, item, color, desc, markerKind)
      if (coverage) {
        addGeometryEntity(ds, `sensor-cov-${id}`, `${name}-覆盖范围`, coverage, color.withAlpha(0.22), desc, {
          quiet: true,
          polygonAlpha: 0.1,
          fitGroup: 'ground',
          markerKind: 'satellite',
        })
      }
      if (dynamicTrack) addSatelliteFootprintEntity(ds, id, name, dynamicTrack, item, color, desc)
      if (!dynamicTrack && wkt) {
        addGeometryEntity(ds, `sensor-${id}`, name, wkt, color, desc, {
          markerKind,
          fitGroup: 'space',
        })
      }
      continue
    }
    const dynamicTrack = addDynamicTrajectory(ds, id, name, item, color, desc, markerKind)
    if (!dynamicTrack && wkt) {
      addGeometryEntity(ds, `sensor-${id}`, name, wkt, color, desc, { markerKind })
    }
    if (track) addGeometryEntity(ds, `sensor-track-${id}`, `${name}-档案轨迹`, track, color, desc)
    if (coverage) {
      addGeometryEntity(ds, `sensor-cov-${id}`, `${name}-覆盖`, coverage, color.withAlpha(0.22), desc, {
        quiet: true,
        polygonAlpha: 0.1,
      })
    }
  }
  enablePointClustering(ds, '#0F766E', -20)
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
      props.platformId != null ? `平台ID: ${props.platformId}` : '',
      props.taskId != null ? `任务ID: ${props.taskId}` : '',
      props.instanceId != null ? `指标实例ID: ${props.instanceId}` : '',
      wkt ? '空间位置: 已加载' : '',
    ]
      .filter(Boolean)
      .join('<br/>')
    addGeometryEntity(ds, `data-${id}`, name, wkt, color, desc, { markerKind: 'data' })

      // 收集点位，用于简易热力/聚合示意（Word C2/D4）。
    const geometry = wktToGeoJson(wkt)
    if (geometry?.type === 'Point') {
      const [lon, lat] = geometry.coordinates as [number, number]
      if (Number.isFinite(lon) && Number.isFinite(lat)) points.push({ lon, lat })
    } else if (geometry?.type === 'LineString') {
      // 轨迹线已在 addGeometryEntity 中绘制。
    }
  }

  // 0.05° 网格聚合热力圈；单点不绘制热力面，避免与点图标重复表达
  const bins = new Map<string, { lon: number; lat: number; count: number }>()
  for (const p of points) {
    const key = `${(Math.floor(p.lon / 0.05) * 0.05).toFixed(2)},${(Math.floor(p.lat / 0.05) * 0.05).toFixed(2)}`
    const cur = bins.get(key)
    if (cur) cur.count += 1
    else bins.set(key, { lon: p.lon, lat: p.lat, count: 1 })
  }
  let bi = 0
  for (const bin of bins.values()) {
    if (bin.count < 2) continue
    const radius = Math.min(7500, 1400 + Math.sqrt(bin.count) * 600)
    const alpha = Math.min(0.3, 0.1 + Math.log2(bin.count) * 0.03)
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

  enablePointClustering(ds, '#1677FF')
  await viewer.dataSources.add(ds)
  return ds
}

export async function loadTaskLayer(
  viewer: Cesium.Viewer,
  features: Array<Record<string, unknown>>,
) {
  const ds = new Cesium.CustomDataSource('tasks')
  const areaCounts = new Map<string, number>()
  for (const item of features) {
    const wkt = String(item.geometryWkt || '')
    if (!/^\s*polygon/i.test(wkt)) continue
    const key = wkt.replace(/\s+/g, '').toUpperCase()
    areaCounts.set(key, (areaCounts.get(key) || 0) + 1)
  }
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
      props.instanceId != null ? `指标实例ID: ${props.instanceId}` : '',
      Array.isArray(props.indicatorInstanceIds)
        ? `关联指标: ${(props.indicatorInstanceIds as unknown[]).join(',')}`
        : '',
      wkt ? '任务区域: 已加载' : '',
    ]
      .filter(Boolean)
      .join('<br/>')
    const areaCount = areaCounts.get(wkt.replace(/\s+/g, '').toUpperCase()) || 1
    addGeometryEntity(ds, `task-${id}`, name, wkt, color, desc, {
      markerKind: 'task',
      polygonAlpha: 0.2 / areaCount,
    })

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
        { markerKind: 'target' },
      )
    }
  }
  enablePointClustering(ds, '#0F3D66', 20)
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
  const ground: Cesium.Entity[] = []
  for (let i = 0; i < viewer.dataSources.length; i += 1) {
    const ds = viewer.dataSources.get(i)
    if (!ds || ds.show === false) continue
    for (const ent of ds.entities.values) {
      // 跳过无几何实体，降低 Cesium flyTo DeveloperError 风险。
      if (ent.position || ent.polygon || ent.polyline || ent.rectangle || ent.ellipse || ent.corridor) {
        all.push(ent)
        const fitGroup = ent.properties?.getValue(viewer.clock.currentTime)?.fitGroup
        if (fitGroup !== 'space') ground.push(ent)
      }
    }
  }
  if (!all.length) {
    flyToChina(viewer)
    return
  }
  const targets = ground.length ? ground : all
  try {
    // 无界面或部分环境下 flyTo Promise 可能无法 resolve，必须超时兜底，避免业务按钮长期“加载中”。
    await Promise.race([
      viewer.flyTo(targets, { duration: 0.8 }),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1800)
      }),
    ])
  } catch {
    try {
      flyToChina(viewer)
    } catch {
      /* 忽略异常 */
    }
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
    markerKind?: MapSymbolKind
    polygonAlpha?: number
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
    addGeometryEntity(ds, `${prefix}-${id}`, getName(item), wkt, color, getDescription(item), {
      markerKind: options?.markerKind,
      polygonAlpha: options?.polygonAlpha,
    })
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
    let color = modeColor[link.mode || 'candidate'] || modeColor.candidate
    // 候选模式：评分颜色从灰色渐变为黄色，再渐变为绿色。
    if ((link.mode || 'candidate') === 'candidate' && link.score != null && Number.isFinite(Number(link.score))) {
      const s = Math.max(0, Math.min(100, Number(link.score)))
      if (s >= 80) color = Cesium.Color.fromCssColorString('#22C55E').withAlpha(0.95)
      else if (s >= 60) color = Cesium.Color.fromCssColorString('#84CC16').withAlpha(0.92)
      else if (s >= 40) color = Cesium.Color.fromCssColorString('#F59E0B').withAlpha(0.92)
      else color = Cesium.Color.fromCssColorString('#94A3B8').withAlpha(0.85)
    }
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
    })
  }
  await viewer.dataSources.add(ds)
  return ds
}
