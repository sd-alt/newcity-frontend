import { reactive, ref, shallowRef } from 'vue'
import * as Cesium from 'cesium'
import { mapToolMode } from './mapTools'
import type { DataSource, Viewer } from 'cesium'
import * as api from '../api/endpoints'
import {
  applyBasemap,
  createViewer,
  flyToChina,
  flyToDataSources,
  loadAssociationLinksLayer,
  loadDataLayer,
  loadSensorLayer,
  loadTaskLayer,
  loadWktFeatureLayer,
  updateSatelliteViewVisibility,
} from './mapLayers'
import { wktToGeoJson } from './wkt'
import { loadMapConfig, type BasemapKey } from './mapConfig'

export type ShellCenter =
  | 'home'
  | 'indicators'
  | 'resources'
  | 'data'
  | 'planning'
  | 'algorithms'
  | 'applications'
  | 'gis'

export const shellViewer = shallowRef<Viewer | null>(null)
export const shellStatus = ref('底图准备中…')
export const shellError = ref<string | null>(null)
export const shellLoading = ref(false)
let reloadGeneration = 0
export const shellBasemap = ref<BasemapKey>('vector')
export const shellCounts = reactive({
  sensors: 0,
  data: 0,
  tasks: 0,
  indicators: 0,
})
export const shellAlerts = reactive({
  offlineSensors: 0,
  faultSensors: 0,
  failedTasks: 0,
  anomalousData: 0,
})
export const shellFilters = reactive({
  sensorType: '',
  sensorStatus: '',
  dataQuality: '',
  dataTimeStart: '',
  dataTimeEnd: '',
  taskStatus: '',
  taskId: '',
  showSensors: true,
  showData: true,
  showTasks: true,
  showIndicators: true,
  /** 数据图层样式：all | points | heat。 */
  dataStyle: 'all',
})
export type ShellFeatureKind = 'sensor' | 'data' | 'task' | 'indicator' | 'unknown'

export type ShellSelected = {
  kind: ShellFeatureKind
  id: string
  name: string
  description: string
  status?: string
  spatial?: string
  relations?: string
}

export const shellRightOpen = ref(false)
export function openShellRight() {
  shellRightOpen.value = true
}
export function closeShellRight() {
  shellRightOpen.value = false
}
export function toggleShellRight() {
  shellRightOpen.value = !shellRightOpen.value
}

export const satelliteClockMultipliers = [1, 10, 60] as const
const SATELLITE_TRAJECTORY_REFRESH_MS = 5 * 60 * 1000
export const satelliteClock = reactive({
  available: false,
  playing: false,
  multiplier: 1,
  currentTimeMs: null as number | null,
  startTimeMs: null as number | null,
  stopTimeMs: null as number | null,
})
let satelliteClockViewer: Viewer | null = null
let satelliteClockTickRemove: (() => void) | null = null
let satelliteClockRangeKey = ''
let satelliteTrajectoryRefreshTimer: ReturnType<typeof setInterval> | null = null
let satelliteTrajectoryRefreshInFlight = false

function clearSatelliteTrajectoryRefreshTimer() {
  if (satelliteTrajectoryRefreshTimer !== null) {
    clearInterval(satelliteTrajectoryRefreshTimer)
    satelliteTrajectoryRefreshTimer = null
  }
}

function clearSatelliteClockState(viewer?: Viewer, preservePlayback = false) {
  const preservedPlayback = preservePlayback
    ? {
        playing: satelliteClock.playing,
        multiplier: satelliteClock.multiplier,
        currentTimeMs: satelliteClock.currentTimeMs,
      }
    : null
  if (satelliteClockTickRemove) satelliteClockTickRemove()
  satelliteClockTickRemove = null
  satelliteClockViewer = null
  satelliteClockRangeKey = ''
  satelliteClock.available = false
  satelliteClock.playing = false
  satelliteClock.multiplier = 1
  satelliteClock.currentTimeMs = null
  satelliteClock.startTimeMs = null
  satelliteClock.stopTimeMs = null
  if (preservedPlayback) {
    satelliteClock.playing = preservedPlayback.playing
    satelliteClock.multiplier = preservedPlayback.multiplier
    satelliteClock.currentTimeMs = preservedPlayback.currentTimeMs
  }
  const target = viewer && !viewer.isDestroyed() ? viewer : null
  if (target) {
    target.clock.shouldAnimate = false
    target.clock.multiplier = 1
    target.clock.clockRange = Cesium.ClockRange.UNBOUNDED
  }
}

function bindSatelliteClockTick(viewer: Viewer) {
  if (satelliteClockViewer === viewer && satelliteClockTickRemove) return
  if (satelliteClockTickRemove) satelliteClockTickRemove()
  const onTick = () => {
    if (!satelliteClock.available || viewer.isDestroyed()) return
    satelliteClock.currentTimeMs = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()
    satelliteClock.playing = viewer.clock.shouldAnimate
    updateSatelliteViewVisibility(viewer)
    viewer.scene.requestRender()
  }
  viewer.clock.onTick.addEventListener(onTick)
  satelliteClockViewer = viewer
  satelliteClockTickRemove = () => viewer.clock.onTick.removeEventListener(onTick)
}

function satelliteClockExtent(viewer: Viewer): { min: number; max: number } | null {
  const sensors = viewer.dataSources.getByName('sensors')[0]
  if (!sensors) return null
  const times: number[] = []
  const time = viewer.clock.currentTime
  for (const entity of sensors.entities.values) {
    try {
      const properties = entity.properties?.getValue(time) as Record<string, unknown> | undefined
      if (properties?.clockTrack !== true) continue
      const start = Number(properties.trajectoryStartMs)
      const stop = Number(properties.trajectoryStopMs)
      if (Number.isFinite(start) && Number.isFinite(stop) && stop > start) {
        times.push(start, stop)
      }
    } catch {
      /* 忽略没有可读属性的实体 */
    }
  }
  if (!times.length) return null
  return { min: Math.min(...times), max: Math.max(...times) }
}

function syncSatelliteClockState(viewer: Viewer) {
  const extent = satelliteClockExtent(viewer)
  if (!extent) {
    if (satelliteClock.available || satelliteClockViewer) clearSatelliteClockState(viewer)
    return
  }
  bindSatelliteClockTick(viewer)
  const rangeKey = `${extent.min}:${extent.max}`
  if (satelliteClockRangeKey !== rangeKey) {
    const previousTime = satelliteClock.currentTimeMs ?? Date.now()
    const now = Math.max(extent.min, Math.min(extent.max, previousTime))
    const shouldAnimate = satelliteClock.currentTimeMs !== null ? satelliteClock.playing : true
    viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(extent.min))
    viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(extent.max))
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP
    viewer.clock.multiplier = satelliteClock.multiplier
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(now))
    viewer.clock.shouldAnimate = shouldAnimate
    satelliteClockRangeKey = rangeKey
  }
  satelliteClock.available = true
  satelliteClock.startTimeMs = extent.min
  satelliteClock.stopTimeMs = extent.max
  satelliteClock.currentTimeMs = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime()
  satelliteClock.playing = viewer.clock.shouldAnimate
  satelliteClock.multiplier = viewer.clock.multiplier
}

export function setSatelliteClockPlaying(playing: boolean) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed() || !satelliteClock.available) return
  viewer.clock.shouldAnimate = playing
  satelliteClock.playing = playing
  viewer.scene.requestRender()
}

export function setSatelliteClockMultiplier(multiplier: number) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed() || !satelliteClock.available) return
  const next = satelliteClockMultipliers.find((value) => value === multiplier) || 1
  viewer.clock.multiplier = next
  satelliteClock.multiplier = next
  viewer.scene.requestRender()
}

export function resetSatelliteClock() {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed() || !satelliteClock.available) return
  const start = satelliteClock.startTimeMs ?? Date.now()
  const stop = satelliteClock.stopTimeMs ?? start
  const now = Math.max(start, Math.min(stop, Date.now()))
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(now))
  viewer.clock.shouldAnimate = false
  satelliteClock.currentTimeMs = now
  satelliteClock.playing = false
  viewer.scene.requestRender()
}

function hasDynamicSatelliteTrajectory() {
  return cacheSensors.some((item) => {
    if (String(item.typeCode || '') !== 'satellite') return false
    const trajectory = (item.trajectory || {}) as { available?: boolean; points?: unknown[] }
    return trajectory.available === true && Array.isArray(trajectory.points) && trajectory.points.length >= 2
  })
}

async function refreshSatelliteTrajectories() {
  const viewer = shellViewer.value
  if (
    satelliteTrajectoryRefreshInFlight ||
    !viewer ||
    viewer.isDestroyed() ||
    !hasDynamicSatelliteTrajectory()
  ) {
    return
  }
  satelliteTrajectoryRefreshInFlight = true
  const requestGeneration = reloadGeneration
  try {
    const response = await api.getSensorGis()
    const refreshed = asList((response.data as { features?: unknown })?.features ?? response.data)
    if (requestGeneration === reloadGeneration && refreshed.length) {
      cacheSensors = refreshed
      await rerenderShellLayers(false)
    }
  } catch {
    // 轨迹刷新失败时保留上一份轨迹，避免地图瞬间退化成空图层。
  } finally {
    satelliteTrajectoryRefreshInFlight = false
  }
}

function scheduleSatelliteTrajectoryRefresh() {
  clearSatelliteTrajectoryRefreshTimer()
  if (typeof window === 'undefined' || !hasDynamicSatelliteTrajectory()) return
  satelliteTrajectoryRefreshTimer = window.setInterval(() => {
    void refreshSatelliteTrajectories()
  }, SATELLITE_TRAJECTORY_REFRESH_MS)
}

export const shellSelected = ref<ShellSelected | null>(null)
export const shellPickScreen = ref<{ x: number; y: number } | null>(null)
export const shellBubbleOpen = ref(false)
let shellBubbleEntity: Cesium.Entity | null = null

export type ShellContextMenu = {
  x: number
  y: number
  kind: ShellFeatureKind | 'blank'
  id: string
  name: string
  lon?: number
  lat?: number
} | null
export const shellContextMenu = ref<ShellContextMenu>(null)

export function closeShellContextMenu() {
  shellContextMenu.value = null
}


const dataSources: DataSource[] = []
let pickHandler: Cesium.ScreenSpaceEventHandler | null = null
let cacheSensors: Array<Record<string, unknown>> = []
let cacheData: Array<Record<string, unknown>> = []
let cacheTasks: Array<Record<string, unknown>> = []
let cacheIndicators: Array<Record<string, unknown>> = []
let hasFittedView = false
let activeShellCenter: ShellCenter = 'home'
let highlightedEntity: Cesium.Entity | null = null
let highlightRestore: (() => void) | null = null
let cameraVisibilityRemove: (() => void) | null = null
let cameraVisibilityFrame: number | null = null
let planningResourceFocus: Set<string> | null = null
let planningPlanFocusId = ''

function asList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (Array.isArray(o.records)) return o.records as Array<Record<string, unknown>>
    if (Array.isArray(o.features)) return o.features as Array<Record<string, unknown>>
    if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>
  }
  return []
}

function centerFromPath(path: string): ShellCenter {
  if (path.startsWith('/tasks')) return 'indicators'
  if (path.startsWith('/resources/data')) return 'data'
  if (path.startsWith('/resources/algorithms')) return 'algorithms'
  if (path.startsWith('/business')) return 'planning'
  if (path.startsWith('/application')) return 'applications'
  if (path.startsWith('/indicators')) return 'indicators'
  if (path.startsWith('/resources')) return 'resources'
  if (path.startsWith('/data')) return 'data'
  if (path.startsWith('/planning')) return 'planning'
  if (path.startsWith('/algorithms')) return 'algorithms'
  if (path.startsWith('/applications')) return 'applications'
  if (path.startsWith('/gis')) return 'gis'
  return 'home'
}

export function getShellLayerProfile(path: string, query: Record<string, unknown> = {}) {
  const center = centerFromPath(path)
  return center === 'gis' ? `${center}:${String(query.tab || 'sensors')}` : center
}

export async function ensureShellViewer(container: HTMLElement): Promise<Viewer> {
  await loadMapConfig()
  const current = shellViewer.value
  if (current && !current.isDestroyed()) return current
  const viewer = createViewer(container, shellBasemap.value)
  try {
    ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
  } catch {
    /* 忽略异常 */
  }
  shellViewer.value = viewer
  try {
    // 关闭默认双击缩放，避免与测距/绘面双击结束冲突
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  } catch {
    /* 忽略异常 */
  }
  bindPick(viewer)
  bindCameraVisibility(viewer)
  flyToChina(viewer)
  shellStatus.value = '底图已加载'
  return viewer
}

export function destroyShellViewer() {
  shellSelected.value = null
  shellPickScreen.value = null
  shellBubbleOpen.value = false
  shellBubbleEntity = null
  bubblePostRenderRemove?.()
  bubblePostRenderRemove = null
  cameraVisibilityRemove?.()
  cameraVisibilityRemove = null
  if (cameraVisibilityFrame != null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(cameraVisibilityFrame)
  }
  cameraVisibilityFrame = null
  shellContextMenu.value = null
  pickHandler?.destroy()
  pickHandler = null
  const viewer = shellViewer.value
  clearSatelliteTrajectoryRefreshTimer()
  satelliteTrajectoryRefreshInFlight = false
  clearSatelliteClockState(viewer && !viewer.isDestroyed() ? viewer : undefined)
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  shellViewer.value = null
  dataSources.length = 0
  cacheSensors = []
  cacheData = []
  cacheTasks = []
  cacheIndicators = []
  planningResourceFocus = null
  planningPlanFocusId = ''
  clearHighlight()
  hasFittedView = false
}

function entityDescription(entity: Cesium.Entity): string {
  try {
    const prop = entity.description
    const raw =
      prop && typeof (prop as { getValue?: (t?: Date) => unknown }).getValue === 'function'
        ? (prop as { getValue: (t?: Date) => unknown }).getValue(new Date())
        : prop
    return String(raw ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  } catch {
    return ''
  }
}

export function parseEntityBizId(entityId: string): { kind: ShellFeatureKind; id: string } {
  const raw = String(entityId || '')
  if (raw.startsWith('sensor-cov-')) return { kind: 'sensor', id: raw.slice('sensor-cov-'.length) }
  if (raw.startsWith('sensor-footprint-')) return { kind: 'sensor', id: raw.slice('sensor-footprint-'.length) }
  if (raw.startsWith('sensor-')) return { kind: 'sensor', id: raw.slice('sensor-'.length) }
  if (raw.startsWith('data-heat-')) return { kind: 'data', id: raw.slice('data-heat-'.length) }
  if (raw.startsWith('data-')) return { kind: 'data', id: raw.slice('data-'.length) }
  if (raw.startsWith('task-')) return { kind: 'task', id: raw.slice('task-'.length) }
  if (raw.startsWith('indicator-')) return { kind: 'indicator', id: raw.slice('indicator-'.length) }
  return { kind: 'unknown', id: raw }
}

function clearHighlight() {
  try {
    highlightRestore?.()
  } catch {
    /* 忽略异常 */
  }
  highlightRestore = null
  if (highlightedEntity) highlightedEntity = null
}

function applyHighlight(entity: Cesium.Entity) {
  clearHighlight()
  highlightedEntity = entity
  const restores: Array<() => void> = []
  if (entity.point) {
    const prev = entity.point.pixelSize
    const prevOutline = entity.point.outlineWidth
    const prevColor = entity.point.outlineColor
    entity.point.pixelSize = new Cesium.ConstantProperty(16)
    entity.point.outlineWidth = new Cesium.ConstantProperty(3)
    entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString('#06B6D4'))
    restores.push(() => {
      entity.point!.pixelSize = prev
      entity.point!.outlineWidth = prevOutline
      entity.point!.outlineColor = prevColor
    })
  }
  if (entity.billboard) {
    const prevScale = entity.billboard.scale
    entity.billboard.scale = new Cesium.ConstantProperty(1.22)
    restores.push(() => {
      entity.billboard!.scale = prevScale
    })
  }
  if (entity.label) {
    const prev = entity.label.show
    entity.label.show = new Cesium.ConstantProperty(true)
    restores.push(() => {
      entity.label!.show = prev
    })
  }
  if (entity.polyline) {
    const prev = entity.polyline.width
    const prevMat = entity.polyline.material
    entity.polyline.width = new Cesium.ConstantProperty(5)
    entity.polyline.material = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#06B6D4'))
    restores.push(() => {
      entity.polyline!.width = prev
      entity.polyline!.material = prevMat
    })
  }
  if (entity.polygon) {
    const prev = entity.polygon.material
    const prevOutline = entity.polygon.outline
    const prevOutlineColor = entity.polygon.outlineColor
    const prevOutlineWidth = entity.polygon.outlineWidth
    entity.polygon.material = new Cesium.ColorMaterialProperty(
      Cesium.Color.fromCssColorString('#06B6D4').withAlpha(0.35),
    )
    entity.polygon.outline = new Cesium.ConstantProperty(true)
    entity.polygon.outlineColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString('#06B6D4'))
    entity.polygon.outlineWidth = new Cesium.ConstantProperty(3)
    restores.push(() => {
      entity.polygon!.material = prev
      entity.polygon!.outline = prevOutline
      entity.polygon!.outlineColor = prevOutlineColor
      entity.polygon!.outlineWidth = prevOutlineWidth
    })
  }
  highlightRestore = () => {
    for (const fn of restores) fn()
  }
}

function findEntityByBiz(kind: ShellFeatureKind, id: string): Cesium.Entity | null {
  const sid = String(id)
  const candidates: string[] = []
  if (kind === 'sensor') candidates.push(`sensor-${sid}`, `sensor-cov-${sid}`, `sensor-footprint-${sid}`)
  else if (kind === 'data') candidates.push(`data-${sid}`, `data-heat-${sid}`)
  else if (kind === 'task') candidates.push(`task-${sid}`)
  else if (kind === 'indicator') candidates.push(`indicator-${sid}`)
  else candidates.push(sid)

  for (const ds of dataSources) {
    for (const ent of ds.entities.values) {
      const eid = String(ent.id || '')
      if (candidates.includes(eid)) return ent
      if (kind !== 'unknown' && eid.endsWith(`-${sid}`) && eid.startsWith(kind)) return ent
    }
  }
  for (const ds of dataSources) {
    for (const ent of ds.entities.values) {
      const eid = String(ent.id || '')
      if (eid === sid || eid.endsWith(`-${sid}`)) return ent
    }
  }
  return null
}

function findEntityById(entityId: string): Cesium.Entity | null {
  for (const ds of dataSources) {
    const entity = ds.entities.getById(entityId)
    if (entity) return entity
  }
  return null
}


function getEntityWorldPosition(entity: Cesium.Entity, time = Cesium.JulianDate.now()): Cesium.Cartesian3 | null {
  try {
    if (entity.position) {
      const p = entity.position.getValue(time)
      if (p) return p
    }
  } catch {
    /* 忽略异常 */
  }
  // 多边形 / 折线使用层级采样计算包围球中心开销较大，优先尝试 _position 或多边形层级的第一个点。
  try {
    const poly = entity.polygon
    if (poly?.hierarchy) {
      const h = poly.hierarchy.getValue(time) as { positions?: Cesium.Cartesian3[] } | undefined
      const positions = h?.positions
      if (positions && positions.length) {
        let x = 0
        let y = 0
        let z = 0
        for (const c of positions) {
          x += c.x
          y += c.y
          z += c.z
        }
        const n = positions.length
        return new Cesium.Cartesian3(x / n, y / n, z / n)
      }
    }
  } catch {
    /* 忽略异常 */
  }
  try {
    const line = entity.polyline
    if (line?.positions) {
      const positions = line.positions.getValue(time) as Cesium.Cartesian3[] | undefined
      if (positions && positions.length) {
        const mid = positions[Math.floor(positions.length / 2)]
        return mid || null
      }
    }
  } catch {
    /* 忽略异常 */
  }
  return null
}

/** 将实体世界坐标投影为画布像素坐标（相对于 Cesium 画布）。 */
export function projectEntityToScreen(entity: Cesium.Entity): { x: number; y: number } | null {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return null
  const world = getEntityWorldPosition(entity)
  if (!world) return null
  const canvas = viewer.scene.canvas
  const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    world,
    new Cesium.Cartesian2(),
  )
  if (!windowPos) return null
  if (!Number.isFinite(windowPos.x) || !Number.isFinite(windowPos.y)) return null
  // 允许目标略微出屏，由界面负责限制位置；距离过远时隐藏跟随气泡，避免产生噪声。
  // 相机飞行期间继续投影，由界面将气泡限制在容器内。
  if (
    windowPos.x < -400 ||
    windowPos.y < -400 ||
    windowPos.x > canvas.clientWidth + 400 ||
    windowPos.y > canvas.clientHeight + 400
  ) {
    return null
  }
  return { x: windowPos.x, y: windowPos.y }
}

export function updateShellBubbleScreen() {
  if (!shellBubbleOpen.value || !shellBubbleEntity) return
  const screen = projectEntityToScreen(shellBubbleEntity)
  if (screen) shellPickScreen.value = screen
}

let bubblePostRenderRemove: (() => void) | null = null

function ensureBubbleFollow(viewer: Viewer) {
  if (bubblePostRenderRemove) return
  const cb = () => {
    if (!shellBubbleOpen.value || !shellBubbleEntity) return
    updateShellBubbleScreen()
  }
  viewer.scene.postRender.addEventListener(cb)
  bubblePostRenderRemove = () => {
    try {
      viewer.scene.postRender.removeEventListener(cb)
    } catch {
    /* 忽略异常 */
    }
    bubblePostRenderRemove = null
  }
}

function scheduleSatelliteVisibility(viewer: Viewer) {
  if (cameraVisibilityFrame != null) return
  const run = () => {
    cameraVisibilityFrame = null
    updateSatelliteViewVisibility(viewer)
  }
  if (typeof window !== 'undefined') cameraVisibilityFrame = window.requestAnimationFrame(run)
  else run()
}

function bindCameraVisibility(viewer: Viewer) {
  cameraVisibilityRemove?.()
  cameraVisibilityRemove = null
  try {
    viewer.camera.percentageChanged = 0.05
    const onChanged = () => scheduleSatelliteVisibility(viewer)
    viewer.camera.changed.addEventListener(onChanged)
    cameraVisibilityRemove = () => viewer.camera.changed.removeEventListener(onChanged)
  } catch {
    /* 忽略异常 */
  }
  updateSatelliteViewVisibility(viewer)
}

function selectFromEntity(
  entity: Cesium.Entity,
  screen?: { x: number; y: number } | null,
  openBubble = true,
) {
  const parsed = parseEntityBizId(String(entity.id || ''))
  const description = entityDescription(entity)
  applyHighlight(entity)
  shellBubbleEntity = entity
  const descLines = description.split('\n').map((s) => s.trim()).filter(Boolean)
  const statusLine = descLines.find((l) => /状态|status|质量/i.test(l))
  const spatialLine = descLines.find((l) => /位置|任务区域|研究区|覆盖|空间范围/i.test(l))
  const relationLines = descLines.filter((l) => /ID|平台|任务|指标|传感器|标识|关联|platform|task|instance|sensor/i.test(l))
  const stripLabel = (line: string) => line.replace(/^[^:：]*[:：]\s*/, '').trim()
  shellSelected.value = {
    kind: parsed.kind,
    id: parsed.id,
    name: String(entity.name || entity.id || '未命名'),
    description,
    status: statusLine ? stripLabel(statusLine) : '',
    spatial: spatialLine ? stripLabel(spatialLine) || spatialLine : '',
    relations: relationLines.join('\n') || description,
  }
  // 始终优先使用实体投影位置，让气泡锚定到要素。
  const projected = projectEntityToScreen(entity)
  if (projected) {
    shellPickScreen.value = projected
  } else if (screen) {
    shellPickScreen.value = screen
  } else {
    const viewer = shellViewer.value
    if (viewer && !viewer.isDestroyed()) {
      shellPickScreen.value = {
        x: Math.round(viewer.scene.canvas.clientWidth * 0.5),
        y: Math.round(viewer.scene.canvas.clientHeight * 0.35),
      }
    }
  }
  shellBubbleOpen.value = openBubble
  if (openBubble && shellSelected.value) shellStatus.value = `已选中：${shellSelected.value.name || shellSelected.value.id}`
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed() && openBubble) ensureBubbleFollow(viewer)
}

function cartesianToLonLat(viewer: Viewer, position: Cesium.Cartesian2): { lon: number; lat: number } | null {
  const ray = viewer.camera.getPickRay(position)
  if (!ray) return null
  const cart = viewer.scene.globe.pick(ray, viewer.scene)
  if (!cart) return null
  const carto = Cesium.Cartographic.fromCartesian(cart)
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  }
}

function openContextMenu(
  viewer: Viewer,
  position: Cesium.Cartesian2,
  entity?: Cesium.Entity | null,
) {
  const ll = cartesianToLonLat(viewer, position)
  if (entity && typeof entity === 'object') {
    selectFromEntity(entity, { x: position.x, y: position.y }, false)
    const parsed = parseEntityBizId(String(entity.id || ''))
    shellContextMenu.value = {
      x: position.x,
      y: position.y,
      kind: parsed.kind,
      id: parsed.id,
      name: String(entity.name || entity.id || '要素'),
      lon: ll?.lon,
      lat: ll?.lat,
    }
  } else {
    shellContextMenu.value = {
      x: position.x,
      y: position.y,
      kind: 'blank',
      id: '',
      name: '地图空白',
      lon: ll?.lon,
      lat: ll?.lat,
    }
  }
}

function bindPick(viewer: Viewer) {
  pickHandler?.destroy()
  pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  pickHandler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
    // 测量/绘制/框选激活时，不抢点击，避免工具与点选互相干扰
    if (mapToolMode.value !== 'none') return
    shellContextMenu.value = null
    const picked = viewer.scene.pick(movement.position)
    const pickedId = picked?.id as Cesium.Entity | Cesium.Entity[] | undefined
    if (Array.isArray(pickedId)) {
      const names = pickedId
        .slice(0, 8)
        .map((entity) => String(entity.name || entity.id || '未命名对象'))
      const summary = [
        ...names,
        pickedId.length > names.length ? `其余 ${pickedId.length - names.length} 个对象` : '',
      ]
        .filter(Boolean)
        .join('\n')
      shellSelected.value = {
        kind: 'unknown',
        id: '',
        name: `聚合点（${pickedId.length} 个对象）`,
        description: summary,
        spatial: '多个对象位于同一区域或同一坐标',
        relations: summary,
      }
      shellPickScreen.value = { x: movement.position.x, y: movement.position.y }
      shellBubbleOpen.value = false
      shellBubbleEntity = null
      shellRightOpen.value = true
      const ll = cartesianToLonLat(viewer, movement.position)
      if (ll) {
        const currentHeight = viewer.camera.positionCartographic.height
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            ll.lon,
            ll.lat,
            Math.max(2500, currentHeight * 0.45),
          ),
          duration: 0.45,
        })
        shellStatus.value = `已展开 ${pickedId.length} 个聚合点`
      }
      return
    }
    const entity = pickedId
    if (!entity || typeof entity !== 'object') {
      shellSelected.value = null
      shellPickScreen.value = null
      shellBubbleOpen.value = false
      shellBubbleEntity = null
      clearHighlight()
      return
    }
    // 将点击位置作为兜底传入；selectFromEntity 内部优先投影到实体点位。
    selectFromEntity(entity, { x: movement.position.x, y: movement.position.y }, true)
    // 下一帧重新锚定到实体真实屏幕位置。
    requestAnimationFrame(() => updateShellBubbleScreen())
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  pickHandler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
    const picked = viewer.scene.pick(movement.position)
    const pickedId = picked?.id as Cesium.Entity | Cesium.Entity[] | undefined
    const entity = Array.isArray(pickedId) ? undefined : pickedId
    openContextMenu(viewer, movement.position, entity && typeof entity === 'object' ? entity : null)
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

  try {
    viewer.scene.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  } catch {
    /* 忽略异常 */
  }
}


/** 确保目标类型已加载并在地图上可见；强制模式下始终刷新。 */
async function ensureFeatureOnMap(kind: ShellFeatureKind, forceRefresh = false): Promise<void> {
  if (kind === 'sensor') {
    setShellVisibility({ showSensors: true })
    // 从列表定位时不应受到左侧面板筛选条件阻挡。
    shellFilters.sensorType = ''
    shellFilters.sensorStatus = ''
    if (forceRefresh || !cacheSensors.length) {
      try {
        const res = await api.getSensorGis()
        cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
    /* 忽略异常 */
      }
    }
  } else if (kind === 'data') {
    setShellVisibility({ showData: true })
    shellFilters.dataQuality = ''
    shellFilters.dataTimeStart = ''
    shellFilters.dataTimeEnd = ''
    if (forceRefresh || !cacheData.length) {
      try {
        const res = await api.getDataGis()
        cacheData = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
    /* 忽略异常 */
      }
    }
  } else if (kind === 'task') {
    setShellVisibility({ showTasks: true })
    shellFilters.taskStatus = ''
    shellFilters.taskId = ''
    if (forceRefresh || !cacheTasks.length) {
      try {
        const res = await api.getTaskGis()
        cacheTasks = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
    /* 忽略异常 */
      }
    }
  } else if (kind === 'indicator') {
    setShellVisibility({ showIndicators: true })
    if (forceRefresh || !cacheIndicators.length) {
      try {
        const res = await api.listInstances('?pageSize=100')
        cacheIndicators = asList(res.data).filter((r) =>
          String(r.spatialWkt || r.geometryWkt || '').trim(),
        )
      } catch {
    /* 忽略异常 */
      }
    }
  } else {
    return
  }
  await rerenderShellLayers(false)
}

/** 列表/搜索到地图：飞行定位、高亮、气泡和详情。 */
export async function selectShellFeature(
  kind: ShellFeatureKind,
  id: string | number,
  options?: { openBubble?: boolean; fly?: boolean },
): Promise<boolean> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return false
  const sid = String(id)

  // 始终先显示目标图层，确保列表和地图的选中状态可见。
  if (kind === 'sensor') setShellVisibility({ showSensors: true })
  else if (kind === 'data') setShellVisibility({ showData: true })
  else if (kind === 'task') setShellVisibility({ showTasks: true })
  else if (kind === 'indicator') setShellVisibility({ showIndicators: true })

  let entity = findEntityByBiz(kind, sid)

  // 软加载：先显示图层，并优先使用现有缓存渲染。
  if (!entity && kind !== 'unknown') {
    await ensureFeatureOnMap(kind, false)
    entity = findEntityByBiz(kind, sid)
  }

  // 强加载：仍未找到目标时重新请求 GIS 数据，处理缓存过期或中心错误。
  if (!entity && kind !== 'unknown') {
    await ensureFeatureOnMap(kind, true)
    entity = findEntityByBiz(kind, sid)
  }

  if (!entity) {
    const summary = buildCacheSummary(kind, sid)
    shellSelected.value = summary
    const openBubble = options?.openBubble !== false
    let ll: [number, number] | null = null
    if (kind === 'sensor') ll = sensorLonLat(sid)
    else if (kind === 'task') ll = taskLonLat(sid)
    else if (kind === 'data') {
      const hit = cacheData.find((r) => String(r.id) === sid)
      if (hit) ll = lonLatFromWkt(String(hit.geometryWkt || hit.locationWkt || ''))
    } else if (kind === 'indicator') {
      const hit = cacheIndicators.find((r) => String(r.id) === sid)
      if (hit) ll = lonLatFromWkt(String(hit.spatialWkt || hit.geometryWkt || ''))
    }
    if (ll && options?.fly !== false) {
      focusLonLat(ll[0], ll[1], 120000)
      shellPickScreen.value = {
        x: Math.round(viewer.scene.canvas.clientWidth * 0.5),
        y: Math.round(viewer.scene.canvas.clientHeight * 0.38),
      }
      shellBubbleOpen.value = openBubble
      shellStatus.value = '已定位 ' + summary.name + '（按缓存坐标定位）'
      return true
    }
    if (openBubble) {
      shellPickScreen.value = {
        x: Math.round(viewer.scene.canvas.clientWidth * 0.5),
        y: Math.round(viewer.scene.canvas.clientHeight * 0.35),
      }
      shellBubbleOpen.value = true
      if (shellSelected.value) {
        shellStatus.value = `已选中：${shellSelected.value.name || shellSelected.value.id}`
      }
    } else {
      shellBubbleOpen.value = false
      shellPickScreen.value = null
    }
    return false
  }

  const openBubble = options?.openBubble !== false
  // 先高亮目标，不依赖过期的相机状态。
  selectFromEntity(entity, null, openBubble)
  if (options?.fly !== false) {
    try {
      const sensor = kind === 'sensor'
        ? cacheSensors.find((item) => String(item.platformId ?? item.id) === sid)
        : null
      const typeCode = String(sensor?.typeCode || '').toLowerCase()
      const isUav = typeCode.includes('uav') || typeCode.includes('drone') || typeCode.includes('无人机')
      const focusEntity = typeCode === 'satellite'
        ? findEntityById(`sensor-footprint-${sid}`) || findEntityById(`sensor-cov-${sid}`) || entity
        : entity
      if (typeCode === 'satellite' && focusEntity !== entity) shellBubbleEntity = focusEntity
      const position = entity.position?.getValue(viewer.clock.currentTime)
      if (isUav && position) {
        const cartographic = Cesium.Cartographic.fromCartesian(position)
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            60000,
          ),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
          duration: 0.9,
        })
      } else {
        await viewer.flyTo(focusEntity, { duration: 0.9 })
      }
    } catch {
    /* 忽略异常 */
    }
    // 飞行结束后，将气泡重新投影到要素点位。
    requestAnimationFrame(() => {
      updateShellBubbleScreen()
      // 渲染完成后的第二个时机。
      setTimeout(() => updateShellBubbleScreen(), 50)
      setTimeout(() => updateShellBubbleScreen(), 200)
      setTimeout(() => updateShellBubbleScreen(), 500)
      setTimeout(() => updateShellBubbleScreen(), 900)
    })
  } else {
    updateShellBubbleScreen()
  }
  return true
}

function buildCacheSummary(kind: ShellFeatureKind, id: string): ShellSelected {
  let name = `${kind} #${id}`
  let description = `ID: ${id}`
  const rows =
    kind === 'sensor'
      ? cacheSensors
      : kind === 'data'
        ? cacheData
        : kind === 'task'
          ? cacheTasks
          : kind === 'indicator'
            ? cacheIndicators
            : []
  const hit = rows.find((r) => {
    const props = (r.properties || r) as Record<string, unknown>
    return (
      String(r.id) === id ||
      String(props.id ?? '') === id ||
      String(props.platformId ?? r.platformId ?? '') === id
    )
  })
  if (hit) {
    const props = (hit.properties || hit) as Record<string, unknown>
    name = String(
      props.platformName ||
        props.name ||
        props.instanceName ||
        props.displayName ||
        props.sensorName ||
        props.code ||
        name,
    )
    description = [
      `类型: ${props.typeName || props.typeCode || kind}`,
      `状态: ${props.status || '-'}`,
      `ID: ${id}`,
      props.platformIdentifier ? `标识: ${props.platformIdentifier}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  let status = ''
  let spatial = ''
  let relations = ''
  if (hit) {
    const p2 = (hit.properties || hit) as Record<string, unknown>
    status = String(p2.status || p2.qualityStatus || p2.runStatus || '-')
    spatial = String(
      p2.geometryWkt ||
        p2.locationWkt ||
        p2.spatialWkt ||
        p2.coverageWkt ||
        p2.researchAreaWkt ||
        p2.wkt ||
        '',
    )
    if (!spatial) {
      const lon = p2.lon ?? p2.longitude ?? p2.lng
      const lat = p2.lat ?? p2.latitude
      if (lon != null && lat != null) spatial = `POINT(${lon} ${lat})`
    }
    relations = [
      p2.platformId != null ? `platformId: ${p2.platformId}` : '',
      p2.taskId != null ? `taskId: ${p2.taskId}` : '',
      p2.instanceId != null ? `instanceId: ${p2.instanceId}` : '',
      p2.sensorId != null ? `sensorId: ${p2.sensorId}` : '',
      p2.platformIdentifier ? `identifier: ${p2.platformIdentifier}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  return { kind, id, name, description, status, spatial, relations }
}


async function clearSources(viewer: Viewer) {
  clearSatelliteClockState(viewer)
  for (const ds of dataSources.splice(0)) {
    try {
      viewer.dataSources.remove(ds, true)
    } catch {
    /* 忽略异常 */
    }
  }
}

function applyVisibility() {
  for (const ds of dataSources) {
    const name = ds.name || ''
    if (name === 'sensors') ds.show = shellFilters.showSensors
    else if (name === 'data') {
      ds.show = shellFilters.showData
      if (ds.show) {
        const style = String((shellFilters as { dataStyle?: string }).dataStyle || 'all')
        const entities = (ds as { entities?: { values: Array<{ id?: unknown; show?: boolean }> } }).entities
        const list = entities?.values || []
        for (const ent of list) {
          const id = String(ent.id || '')
          const isHeat = id.startsWith('data-heat-')
          if (style === 'heat') ent.show = isHeat
          else if (style === 'points') ent.show = !isHeat
          else ent.show = true
        }
      }
    } else if (name === 'tasks') ds.show = shellFilters.showTasks
    else if (name === 'indicators') ds.show = shellFilters.showIndicators
    else if (name === 'assoc-links') ds.show = activeShellCenter === 'planning' && (shellFilters.showSensors || shellFilters.showTasks)
    else if (name.startsWith('algo-')) ds.show = activeShellCenter === 'algorithms'
    else if (name.startsWith('planning-') || name.includes('coverage') || name.includes('gap')) ds.show = activeShellCenter === 'planning'
    else ds.show = true
  }
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function hasDataSource(name: string) {
  return dataSources.some((ds) => (ds.name || '') === name)
}

function filteredSensors() {
  const t = shellFilters.sensorType.trim().toLowerCase()
  const st = shellFilters.sensorStatus.trim().toLowerCase()
  return cacheSensors.filter((item) => {
    if (activeShellCenter === 'planning' && planningResourceFocus) {
      const id = String(item.platformId ?? item.id ?? '')
      if (!planningResourceFocus.has(id)) return false
    }
    if (t) {
      const code = String(item.typeCode || item.typeName || '').toLowerCase()
      if (!code.includes(t)) return false
    }
    if (st) {
      const status = String(item.status || '').toLowerCase()
      if (!status.includes(st)) return false
    }
    return true
  })
}

function filteredTasks() {
  const st = shellFilters.taskStatus.trim().toLowerCase()
  return cacheTasks.filter((t) => {
    if (shellFilters.taskId && String(t.id) !== String(shellFilters.taskId)) return false
    if (st) {
      const props = (t.properties || t) as Record<string, unknown>
      const status = String(props.status || t.status || '').toLowerCase()
      if (!status.includes(st)) return false
    }
    return true
  })
}

function itemObservedMs(item: Record<string, unknown>): number | null {
  const props = (item.properties || item) as Record<string, unknown>
  const raw =
    props.observedAt ||
    props.timeStart ||
    props.time_start ||
    props.observed_at ||
    item.observedAt ||
    item.timeStart
  if (raw == null || raw === '') return null
  const t = Date.parse(String(raw))
  return Number.isFinite(t) ? t : null
}

function filteredData() {
  const q = shellFilters.dataQuality.trim().toLowerCase()
  let rows = cacheData
  if (q) {
    rows = rows.filter((item) => {
      const props = (item.properties || item) as Record<string, unknown>
      const quality = String(props.qualityStatus || props.quality || '').toLowerCase()
      if (q === 'anomaly' || q === 'bad' || q === '异常') {
        return (
          quality.includes('bad') ||
          quality.includes('anomaly') ||
          quality.includes('fail') ||
          quality.includes('invalid') ||
          quality.includes('warning') ||
          quality.includes('异常') ||
          quality.includes('告警')
        )
      }
      if (q === 'normal' || q === 'ok' || q === '正常') {
        return (
          quality.includes('normal') ||
          quality.includes('ok') ||
          quality.includes('good') ||
          quality.includes('pass') ||
          quality.includes('正常') ||
          quality.includes('合格')
        )
      }
      if (q === 'unchecked' || q === '未检') {
        return (
          quality === '' ||
          quality.includes('unchecked') ||
          quality.includes('unknown') ||
          quality.includes('pending') ||
          quality.includes('未')
        )
      }
      return quality.includes(q)
    })
  }
  const ts = shellFilters.dataTimeStart.trim()
  const te = shellFilters.dataTimeEnd.trim()
  if (ts || te) {
    const startMs = ts ? Date.parse(ts) : Number.NEGATIVE_INFINITY
    const endMs = te ? Date.parse(te) : Number.POSITIVE_INFINITY
    rows = rows.filter((item) => {
      const t = itemObservedMs(item)
      if (t == null) return true
      return t >= startMs && t <= endMs
    })
  }
  return rows
}


function recomputeAlerts() {
  let offline = 0
  let fault = 0
  for (const item of cacheSensors) {
    const props = (item.properties || item) as Record<string, unknown>
    const st = String(props.status || props.runStatus || props.onlineStatus || '').toLowerCase()
    if (st.includes('offline') || st.includes('离线') || st === 'down') offline += 1
    if (st.includes('fault') || st.includes('error') || st.includes('故障') || st.includes('维护')) fault += 1
  }
  let failedTasks = 0
  for (const item of cacheTasks) {
    const props = (item.properties || item) as Record<string, unknown>
    const st = String(props.status || '').toLowerCase()
    if (st.includes('fail') || st.includes('error') || st.includes('失败') || st.includes('取消')) failedTasks += 1
  }
  let anomalous = 0
  for (const item of cacheData) {
    const props = (item.properties || item) as Record<string, unknown>
    const q = String(props.qualityStatus || props.quality || props.status || '').toLowerCase()
    if (q.includes('bad') || q.includes('异常') || q.includes('fail') || q.includes('invalid') || q.includes('warning') || q.includes('告警')) anomalous += 1
  }
  shellAlerts.offlineSensors = offline
  shellAlerts.faultSensors = fault
  shellAlerts.failedTasks = failedTasks
  shellAlerts.anomalousData = anomalous
}

export async function reloadShellLayers(
  path: string,
  query: Record<string, unknown> = {},
  options?: { preserveExisting?: boolean },
) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  const center = centerFromPath(path)
  const preserveExisting = options?.preserveExisting === true
  const routePlanId = String(query.planId ?? '')
  if (center !== 'planning' || (planningPlanFocusId && planningPlanFocusId !== routePlanId)) {
    planningResourceFocus = null
    planningPlanFocusId = ''
  }
  activeShellCenter = center
  const gen = ++reloadGeneration
  clearSatelliteTrajectoryRefreshTimer()
  shellLoading.value = true
  shellError.value = null
  shellStatus.value = '正在加载业务图层…'
  const safetyTimer = typeof window !== 'undefined'
    ? window.setTimeout(() => {
        if (gen === reloadGeneration && shellLoading.value) {
          shellLoading.value = false
          if (String(shellStatus.value).includes('正在加载')) {
            shellStatus.value = '图层加载较慢，可继续操作或点刷新'
          }
        }
      }, 5000)
    : 0
  if (!preserveExisting) {
    await clearSources(viewer)
    shellCounts.sensors = 0
    shellCounts.data = 0
    shellCounts.tasks = 0
    shellCounts.indicators = 0
    shellAlerts.offlineSensors = 0
    shellAlerts.faultSensors = 0
    shellAlerts.failedTasks = 0
    shellAlerts.anomalousData = 0
  }

  if (center === 'gis') {
    const tab = String(query.tab || 'sensors')
    shellFilters.showSensors = tab === 'sensors'
    shellFilters.showData = tab === 'data'
    shellFilters.showTasks = tab === 'tasks'
  } else if (center === 'resources') {
    shellFilters.showSensors = true
    shellFilters.showData = false
    shellFilters.showTasks = false
    shellFilters.showIndicators = false
  } else if (center === 'data') {
    shellFilters.showSensors = false
    shellFilters.showData = true
    shellFilters.showTasks = false
    shellFilters.showIndicators = false
  } else if (center === 'planning') {
    // 任务区 + 候选传感资源，便于规划关联
    shellFilters.showSensors = true
    shellFilters.showData = false
    shellFilters.showTasks = true
    shellFilters.showIndicators = true
  } else if (center === 'algorithms') {
    shellFilters.showSensors = true
    shellFilters.showData = true
    shellFilters.showTasks = true
    shellFilters.showIndicators = false
  } else if (center === 'indicators') {
    shellFilters.showSensors = false
    shellFilters.showData = false
    shellFilters.showTasks = false
    shellFilters.showIndicators = true
  } else {
    shellFilters.showSensors = true
    shellFilters.showData = true
    shellFilters.showTasks = true
    shellFilters.showIndicators = true
  }

  try {
    const needSensors =
      shellFilters.showSensors || center === 'home' || center === 'applications' || center === 'gis'
    const needData =
      shellFilters.showData ||
      center === 'home' ||
      center === 'applications' ||
      center === 'algorithms' ||
      center === 'gis'
    const needTasks =
      shellFilters.showTasks ||
      center === 'home' ||
      center === 'applications' ||
      center === 'planning' ||
      center === 'algorithms' ||
      center === 'gis'
    const needIndicators =
      center === 'indicators' ||
      center === 'home' ||
      center === 'applications' ||
      center === 'planning'
    const loadSensors = needSensors && (!preserveExisting || !hasDataSource('sensors'))
    const loadData = needData && (!preserveExisting || !hasDataSource('data'))
    const loadTasks = needTasks && (!preserveExisting || !hasDataSource('tasks'))
    const loadIndicators = needIndicators && (!preserveExisting || !hasDataSource('indicators'))

    if (preserveExisting) applyVisibility()

    if (loadSensors) {
      const res = await api.getSensorGis()
      cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
    } else if (!needSensors && !preserveExisting) {
      cacheSensors = []
    }
    if (loadData) {
      const res = await api.getDataGis()
      cacheData = asList((res.data as { features?: unknown })?.features ?? res.data)
    } else if (!needData && !preserveExisting) {
      cacheData = []
    }
    if (loadTasks) {
      const res = await api.getTaskGis()
      cacheTasks = asList((res.data as { features?: unknown })?.features ?? res.data)
      if (query.taskId) shellFilters.taskId = String(query.taskId)
    } else if (!needTasks && !preserveExisting) {
      cacheTasks = []
    }

    if (loadSensors) {
      const feats = filteredSensors()
      const ds = await loadSensorLayer(viewer, feats)
      dataSources.push(ds)
      shellCounts.sensors = feats.length
    }
    if (loadData) {
      const dataFeats = filteredData()
      const ds = await loadDataLayer(viewer, dataFeats)
      dataSources.push(ds)
      shellCounts.data = dataFeats.length
    }
    if (loadTasks) {
      const feats = filteredTasks()
      const ds = await loadTaskLayer(viewer, feats)
      dataSources.push(ds)
      shellCounts.tasks = feats.length
    }
    // 指标范围：感知指标中心为主，首页/综合/规划也展示以便业务串联
    if (loadIndicators) {
      const res = await api.listInstances('?pageSize=100')
      const rows = asList(res.data).filter((r) => String(r.spatialWkt || r.geometryWkt || '').trim())
      cacheIndicators = rows
      const ds = await loadWktFeatureLayer(viewer, rows, {
        idPrefix: 'indicator',
        name: 'indicators',
        color: Cesium.Color.fromCssColorString('#be123c').withAlpha(0.75),
        markerKind: 'indicator',
        polygonAlpha: 0.14,
        getWkt: (item) => String(item.spatialWkt || item.geometryWkt || ''),
        getName: (item) =>
          String(item.displayName || item.instanceName || item.name || item.code || item.id),
        getDescription: (item) =>
          [
            `实例: ${item.instanceName || item.name || '-'}`,
            `状态: ${item.status || '-'}`,
            `定义: ${item.definitionCode || item.definitionName || '-'}`,
            `实例ID: ${item.id}`,
            item.definitionId != null ? `定义ID: ${item.definitionId}` : '',
            String(item.spatialWkt || item.geometryWkt || '').trim() ? '空间范围: 已加载' : '',
          ]
            .filter(Boolean)
            .join('<br/>'),
      })
      dataSources.push(ds)
      shellCounts.indicators = rows.length
    } else if (!needIndicators && !preserveExisting) {
      cacheIndicators = []
    }

    if (gen !== reloadGeneration) return
    recomputeAlerts()
    applyVisibility()
    syncSatelliteClockState(viewer)
    scheduleSatelliteTrajectoryRefresh()
    updateSatelliteViewVisibility(viewer)
    if (!hasFittedView) {
      await flyToDataSources(viewer)
      if (gen !== reloadGeneration) return
      hasFittedView = true
    }
    const total =
      (shellFilters.showSensors ? shellCounts.sensors : 0) +
      (shellFilters.showData ? shellCounts.data : 0) +
      (shellFilters.showTasks ? shellCounts.tasks : 0) +
      (shellFilters.showIndicators ? shellCounts.indicators : 0)
    shellStatus.value =
      total > 0 ? `底图就绪 · 当前上图 ${total} 个要素` : '底图就绪 · 暂无业务空间要素（仍可浏览底图）'
  } catch (err) {
    if (gen !== reloadGeneration) return
    const msg = err instanceof Error ? err.message : '图层加载失败'
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status?: number }).status) : 0
    if (status === 401 || status === 403 || /credentials|Authentication|未登录|Forbidden/i.test(msg)) {
      shellError.value = '请先登录后加载业务图层'
      shellStatus.value = '未登录 · 底图可用，业务图层需登录'
    } else {
      shellError.value = msg
      shellStatus.value = '底图就绪（业务图层加载失败）'
    }
    if (!preserveExisting) flyToChina(viewer)
  } finally {
    if (safetyTimer) window.clearTimeout(safetyTimer)
    if (gen === reloadGeneration) shellLoading.value = false
  }
}

export async function rerenderShellLayers(fitView = true) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  clearSatelliteClockState(viewer, true)
  for (const ds of dataSources.splice(0)) {
    try {
      viewer.dataSources.remove(ds, true)
    } catch {
      /* 忽略异常 */
    }
  }
  if (cacheSensors.length) {
    const feats = filteredSensors()
    dataSources.push(await loadSensorLayer(viewer, feats))
    shellCounts.sensors = feats.length
  }
  if (cacheData.length) {
    const dataFeats = filteredData()
    dataSources.push(await loadDataLayer(viewer, dataFeats))
    shellCounts.data = dataFeats.length
  }
  if (cacheTasks.length) {
    const feats = filteredTasks()
    dataSources.push(await loadTaskLayer(viewer, feats))
    shellCounts.tasks = feats.length
  }
  if (cacheIndicators.length) {
    dataSources.push(
      await loadWktFeatureLayer(viewer, cacheIndicators, {
        idPrefix: 'indicator',
        name: 'indicators',
        color: Cesium.Color.fromCssColorString('#be123c').withAlpha(0.75),
        markerKind: 'indicator',
        polygonAlpha: 0.14,
        getWkt: (item) => String(item.spatialWkt || item.geometryWkt || ''),
        getName: (item) =>
          String(item.displayName || item.instanceName || item.name || item.code || item.id),
      }),
    )
    shellCounts.indicators = cacheIndicators.length
  }
  applyVisibility()
  syncSatelliteClockState(viewer)
  scheduleSatelliteTrajectoryRefresh()
  updateSatelliteViewVisibility(viewer)
  if (fitView) await flyToDataSources(viewer)
}


export function getCachedDataTimeExtent(): { min: number; max: number; count: number } | null {
  const times: number[] = []
  for (const item of cacheData) {
    const t = itemObservedMs(item as Record<string, unknown>)
    if (t != null) times.push(t)
  }
  if (!times.length) return null
  return { min: Math.min(...times), max: Math.max(...times), count: times.length }
}

export async function setDataTimeWindow(startMs: number, endMs: number, options?: { fit?: boolean }) {
  const start = Number.isFinite(startMs) ? new Date(startMs).toISOString() : ''
  const end = Number.isFinite(endMs) ? new Date(endMs).toISOString() : ''
  await patchShellFilters(
    {
      showSensors: false,
      showData: true,
      showTasks: false,
      dataTimeStart: start,
      dataTimeEnd: end,
    },
    { fit: options?.fit === true, rerender: true },
  )
}

export async function clearDataTimeWindow(options?: { fit?: boolean }) {
  await patchShellFilters(
    { dataTimeStart: '', dataTimeEnd: '' },
    { fit: options?.fit === true, rerender: true },
  )
}

export function setShellVisibility(partial: Partial<typeof shellFilters>) {
  Object.assign(shellFilters, partial)
  applyVisibility()
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed()) updateSatelliteViewVisibility(viewer)
}

/** 更新图层可见性和属性筛选，并按需重新渲染要素。 */
export async function patchShellFilters(
  partial: Partial<typeof shellFilters>,
  options?: { fit?: boolean; rerender?: boolean },
) {
  Object.assign(shellFilters, partial)
  const needRerender =
    options?.rerender === true ||
    partial.sensorType !== undefined ||
    partial.sensorStatus !== undefined ||
    partial.dataQuality !== undefined ||
    partial.dataTimeStart !== undefined ||
    partial.dataTimeEnd !== undefined ||
    partial.taskStatus !== undefined ||
    partial.taskId !== undefined
  if (needRerender) {
    await rerenderShellLayers(options?.fit === true)
  } else {
    applyVisibility()
  }
  applyVisibility()
}

export function resetShellView() {
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed()) flyToChina(viewer)
}

export function getCachedTasks() {
  return cacheTasks
}

export function getSensorTypeOptions() {
  const set = new Set<string>()
  for (const item of cacheSensors) {
    const v = String(item.typeName || item.typeCode || '').trim()
    if (v) set.add(v)
  }
  return Array.from(set).sort()
}

export async function setShellBasemap(key: BasemapKey) {
  await loadMapConfig()
  const viewer = shellViewer.value
  shellBasemap.value = key
  if (!viewer || viewer.isDestroyed()) return
  try {
    applyBasemap(viewer, key)
    shellError.value = null
  } catch {
    try {
      applyBasemap(viewer, 'vector')
      shellBasemap.value = 'vector'
      shellError.value = null
      shellStatus.value = '底图加载失败，已回退标准地图'
    } catch (err2) {
      shellError.value = err2 instanceof Error ? err2.message : '底图加载失败'
    }
  }
}

export type ShellLayerMode = 'sensors' | 'data' | 'tasks' | 'all'

export async function focusShellMode(mode: ShellLayerMode, path = '/applications') {
    // 先按路由装载缓存图层，再强制可见性（避免被中心区域默认上图策略覆盖）。
  await reloadShellLayers(path, {})
  if (mode === 'sensors') {
    setShellVisibility({ showSensors: true, showData: false, showTasks: false, showIndicators: false })
  } else if (mode === 'data') {
    setShellVisibility({ showSensors: false, showData: true, showTasks: false, showIndicators: false })
  } else if (mode === 'tasks') {
    setShellVisibility({ showSensors: false, showData: false, showTasks: true, showIndicators: false })
  } else {
    setShellVisibility({ showSensors: true, showData: true, showTasks: true, showIndicators: true })
  }
  const total =
    (shellFilters.showSensors ? shellCounts.sensors : 0) +
    (shellFilters.showData ? shellCounts.data : 0) +
    (shellFilters.showTasks ? shellCounts.tasks : 0) +
    shellCounts.indicators
  shellStatus.value =
    mode === 'sensors'
      ? `已切换：仅传感器（${shellCounts.sensors}）`
      : mode === 'data'
        ? `已切换：仅监测数据（${shellCounts.data}）`
        : mode === 'tasks'
          ? `已切换：仅观测任务（${shellCounts.tasks}）`
          : `已切换：全部业务图层（上图 ${total}）`
}

export async function applyShellSensorTypeFilter(typeCode: string) {
  shellFilters.sensorType = typeCode || ''
  shellFilters.showSensors = true
  shellFilters.showData = false
  shellFilters.showTasks = false
  await rerenderShellLayers()
}

export async function applyShellSensorStatusFilter(status: string) {
  shellFilters.sensorStatus = status || ''
  shellFilters.showSensors = true
  shellFilters.showData = false
  shellFilters.showTasks = false
  await rerenderShellLayers()
  shellStatus.value = status
    ? `传感器状态筛选: ${status} · ${shellCounts.sensors} 个`
    : `传感器状态筛选已清除`
}


export async function setDataLayerStyle(style: 'all' | 'points' | 'heat') {
  shellFilters.dataStyle = style
  shellFilters.showData = true
  shellFilters.showSensors = false
  shellFilters.showTasks = false
  shellFilters.showIndicators = false
  applyVisibility()
  const label = style === 'heat' ? '热力聚合' : style === 'points' ? '采样点' : '点+热力'
  shellStatus.value = `数据图层样式：${label}（${shellCounts.data} 个数据要素）`
}

export async function applyShellDataQualityFilter(quality: string) {
  shellFilters.dataQuality = quality || ''
  shellFilters.showSensors = false
  shellFilters.showData = true
  shellFilters.showTasks = false
  await rerenderShellLayers()
  shellStatus.value = quality
    ? `数据质量筛选: ${quality} · ${shellCounts.data} 个`
    : `数据质量筛选已清除`
}

export async function applyShellTaskStatusFilter(status: string) {
  shellFilters.taskStatus = status || ''
  shellFilters.showSensors = false
  shellFilters.showData = false
  shellFilters.showTasks = true
  await rerenderShellLayers()
  shellStatus.value = status
    ? `任务状态筛选: ${status} · ${shellCounts.tasks} 个`
    : `任务状态筛选已清除`
}

export async function clearShellBizFilters() {
  shellFilters.sensorType = ''
  shellFilters.sensorStatus = ''
  shellFilters.dataQuality = ''
  shellFilters.dataTimeStart = ''
  shellFilters.dataTimeEnd = ''
  shellFilters.taskStatus = ''
  shellFilters.taskId = ''
  await rerenderShellLayers()
  shellStatus.value = '已清除业务筛选，显示当前图层全部要素'
}

export function shellActiveFilterSummary() {
  const parts: string[] = []
  if (shellFilters.sensorType) parts.push(`类型:${shellFilters.sensorType}`)
  if (shellFilters.sensorStatus) parts.push(`传感状态:${shellFilters.sensorStatus}`)
  if (shellFilters.dataQuality) parts.push(`质量:${shellFilters.dataQuality}`)
  if (shellFilters.dataTimeStart || shellFilters.dataTimeEnd) parts.push(`时间窗`)
  if (shellFilters.taskStatus) parts.push(`任务状态:${shellFilters.taskStatus}`)
  if (shellFilters.taskId) parts.push(`任务#${shellFilters.taskId}`)
  return parts.join(' · ')
}

export function closeShellBubble() {
  shellBubbleOpen.value = false
  shellBubbleEntity = null
}

export async function fitShellView() {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  await flyToDataSources(viewer)
  hasFittedView = true
}


/** 业务按钮：刷新指定中心图层并缩放到可见要素 */
export async function showShellAndFit(mode: ShellLayerMode, path: string) {
  await focusShellMode(mode, path)
  void fitShellView()
}

// ---------- 规划关联地图业务链路 ----------

export type AssocLinkMode = 'candidate' | 'basic' | 'optimized' | 'supplement'

function lonLatFromWkt(wkt: string): [number, number] | null {
  const g = wktToGeoJson(wkt)
  if (!g) return null
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number]
    return [lon, lat]
  }
  const coords =
    g.type === 'Polygon'
      ? (g.coordinates as number[][][])[0]
      : g.type === 'LineString'
        ? (g.coordinates as number[][])
        : g.type === 'MultiPoint'
          ? (g.coordinates as number[][])
          : null
  if (!coords || !coords.length) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const c of coords) {
    if (!c || c.length < 2) continue
    sx += Number(c[0])
    sy += Number(c[1])
    n += 1
  }
  if (!n) return null
  return [sx / n, sy / n]
}

function sensorLonLat(platformId: string | number): [number, number] | null {
  const sid = String(platformId)
  const item = cacheSensors.find((r) => String(r.platformId ?? r.id) === sid)
  if (!item) return null
  const wkt = String(
    item.locationWkt ||
      (item.spatial as { positionWkt?: string } | undefined)?.positionWkt ||
      '',
  )
  return lonLatFromWkt(wkt)
}

function taskLonLat(taskId: string | number): [number, number] | null {
  const tid = String(taskId)
  const item = cacheTasks.find((r) => String(r.id) === tid)
  if (!item) return null
  const wkt = String(item.geometryWkt || '')
  return lonLatFromWkt(wkt)
}

async function removeDataSourceByName(name: string) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  const keep: typeof dataSources = []
  for (const ds of dataSources) {
    if ((ds.name || '') === name) {
      try {
        viewer.dataSources.remove(ds, true)
      } catch {
    /* 忽略异常 */
      }
    } else {
      keep.push(ds)
    }
  }
  dataSources.length = 0
  dataSources.push(...keep)
  // 兜底：清理 viewer 中同名残留（避免 ID 冲突）
  try {
    const bag: Array<{ name?: string }> = []
    for (let i = 0; i < viewer.dataSources.length; i += 1) {
      const ds = viewer.dataSources.get(i)
      if (ds && (ds.name || '') === name) bag.push(ds as { name?: string })
    }
    for (const ds of bag) {
      try {
        viewer.dataSources.remove(ds as never, true)
      } catch {
    /* 忽略异常 */
      }
    }
  } catch {
    /* 忽略异常 */
  }
}

/** 规划工作区：同时显示任务和传感资源。 */
export async function showPlanningWorkspace(path = '/planning') {
  planningResourceFocus = null
  planningPlanFocusId = ''
  shellFilters.taskId = ''
  await reloadShellLayers(path, {})
  setShellVisibility({ showSensors: true, showData: false, showTasks: true })
  await fitShellView()
  shellStatus.value = `规划工作台：任务 ${shellCounts.tasks} · 传感资源 ${shellCounts.sensors}`
}

/** 仅显示当前方案资源，避免同任务其他方案混入地图。 */
export async function showPlanningPlanWorkspace(input: {
  planId: string | number
  taskId: string | number
  resourceIds: Array<string | number>
}) {
  planningPlanFocusId = String(input.planId)
  planningResourceFocus = new Set(input.resourceIds.map(String))
  shellFilters.taskId = String(input.taskId)
  await reloadShellLayers('/planning', {
    taskId: String(input.taskId),
    planId: String(input.planId),
  })
  setShellVisibility({ showSensors: true, showData: false, showTasks: true, showIndicators: true })
  await fitShellView()
  const resourceLabel = planningResourceFocus.size ? `资源 ${planningResourceFocus.size} 个` : '尚未配置资源'
  shellStatus.value = `方案 #${input.planId}：${resourceLabel}`
}

/** 指标工作区：仅显示指标实例范围。 */
export async function showIndicatorsWorkspace(path = '/indicators') {
  if (!cacheIndicators.length) {
    await reloadShellLayers(path, {})
  } else {
    setShellVisibility({ showSensors: false, showData: false, showTasks: false, showIndicators: true })
    await rerenderShellLayers(false)
  }
  setShellVisibility({ showSensors: false, showData: false, showTasks: false, showIndicators: true })
  shellStatus.value = `指标范围上图：${shellCounts.indicators} 个实例`
  void fitShellView()
}


function isEmptyWkt(wkt: string): boolean {
  const s = String(wkt || '').trim().toUpperCase()
  return !s || s.includes('EMPTY')
}

async function pushWktOverlay(
  name: string,
  idPrefix: string,
  wkt: string,
  label: string,
  colorCss: string,
  alpha = 0.35,
) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return 0
  if (isEmptyWkt(wkt)) return 0
  await removeDataSourceByName(name)
  const ds = await loadWktFeatureLayer(
    viewer,
    [{ id: idPrefix, name: label, spatialWkt: wkt, description: label }],
    {
      idPrefix,
      name,
      color: Cesium.Color.fromCssColorString(colorCss).withAlpha(alpha),
      getWkt: (item) => String(item.spatialWkt || ''),
      getName: (item) => String(item.name || label),
      getDescription: (item) => String(item.description || label),
    },
  )
  dataSources.push(ds)
  return 1
}

async function pushGeoJsonOverlay(
  name: string,
  geometry: Record<string, unknown> | null | undefined,
  label: string,
  colorCss: string,
  alpha = 0.35,
) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed() || !geometry) return 0
  await removeDataSourceByName(name)
  try {
    const color = Cesium.Color.fromCssColorString(colorCss)
    const ds = await Cesium.GeoJsonDataSource.load(
      {
        type: 'Feature',
        properties: { name: label, description: label },
        geometry,
      },
      {
        stroke: color,
        fill: color.withAlpha(alpha),
        strokeWidth: 2,
        clampToGround: true,
      },
    )
    ds.name = name
    await viewer.dataSources.add(ds)
    dataSources.push(ds)
    return 1
  } catch {
    return 0
  }
}

/** 规划覆盖表达：任务区(蓝) + 已覆盖(绿) + 缺口(红) */
export async function drawPlanningCoverageOverlay(input: {
  taskGeoJson?: Record<string, unknown> | null
  taskWkt?: string
  coverageWkt?: string
  gapWkt?: string
  fit?: boolean
}): Promise<{ task: number; coverage: number; gap: number }> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return { task: 0, coverage: 0, gap: 0 }

  const task = input.taskGeoJson
    ? await pushGeoJsonOverlay(
        'planning-task-area',
        input.taskGeoJson,
        '任务目标区域',
        '#1677FF',
        0.22,
      )
    : await pushWktOverlay(
        'planning-task-area',
        'plan-task',
        String(input.taskWkt || ''),
        '任务目标区域',
        '#1677FF',
        0.22,
      )
  const coverage = await pushWktOverlay(
    'planning-coverage',
    'plan-cover',
    String(input.coverageWkt || ''),
    '方案覆盖范围',
    '#22C55E',
    0.28,
  )
  const gap = await pushWktOverlay(
    'planning-gap',
    'plan-gap',
    String(input.gapWkt || ''),
    '覆盖缺口',
    '#EF4444',
    0.4,
  )
  applyVisibility()
  if (input.fit !== false && task + coverage + gap > 0) await fitShellView()
  const parts: string[] = []
  if (task) parts.push('任务区')
  if (coverage) parts.push('覆盖')
  if (gap) parts.push('缺口')
  shellStatus.value = parts.length
    ? `规划覆盖上图：${parts.join(' · ')}`
    : '无可绘制的覆盖/缺口几何'
  return { task, coverage, gap }
}

export async function clearPlanningCoverageOverlay() {
  await removeDataSourceByName('planning-task-area')
  await removeDataSourceByName('planning-coverage')
  await removeDataSourceByName('planning-gap')
  shellStatus.value = '已清除规划覆盖图层'
}

/** 算法输入/结果区域上图 */
export async function drawAlgoRegionOverlay(input: {
  inputGeoJson?: Record<string, unknown> | null
  resultGeoJson?: Record<string, unknown> | null
  inputWkt?: string
  resultWkt?: string
  fit?: boolean
  inputLabel?: string
  resultLabel?: string
}): Promise<number> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return 0
  await removeDataSourceByName('algo-input-area')
  await removeDataSourceByName('algo-result-area')
  let n = 0
  n += input.inputGeoJson
    ? await pushGeoJsonOverlay(
        'algo-input-area',
        input.inputGeoJson,
        input.inputLabel || '算法输入区域',
        '#7C3AED',
        0.3,
      )
    : await pushWktOverlay(
        'algo-input-area',
        'algo-in',
        String(input.inputWkt || ''),
        input.inputLabel || '算法输入区域',
        '#7C3AED',
        0.3,
      )
  n += input.resultGeoJson
    ? await pushGeoJsonOverlay(
        'algo-result-area',
        input.resultGeoJson,
        input.resultLabel || '算法结果区域',
        '#F59E0B',
        0.35,
      )
    : await pushWktOverlay(
        'algo-result-area',
        'algo-out',
        String(input.resultWkt || ''),
        input.resultLabel || '算法结果区域',
        '#F59E0B',
        0.35,
      )
  applyVisibility()
  if (input.fit !== false && n > 0) await fitShellView()
  shellStatus.value = n ? `算法区域上图 ${n} 层` : '无可绘制的算法区域'
  return n
}

export async function clearAlgoRegionOverlay() {
  await removeDataSourceByName('algo-input-area')
  await removeDataSourceByName('algo-result-area')
  shellStatus.value = '已清除算法区域图层'
}

export async function clearAssociationLinks() {
  await removeDataSourceByName('assoc-links')
  shellStatus.value = '已清除关联连线'
}

/**
 * 在地图上绘制任务与传感器的关联连线。
 * 模式：候选（灰色）/ 基础（蓝色）/ 优化（绿色）/ 补充（橙色）。
 */
export async function drawAssociationLinks(
  taskId: string | number,
  links: Array<{
    platformId: string | number
    score?: number
    mode?: AssocLinkMode
    name?: string
    reason?: string
  }>,
  options?: { fit?: boolean; ensureLayers?: boolean },
) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return 0

  if (options?.ensureLayers !== false) {
    // 仅补齐坐标缓存；避免与中心图层 reload 并发 clearSources 引发 Cesium DeveloperError
    try {
      if (!cacheSensors.length || !cacheTasks.length) {
        const [sRes, tRes] = await Promise.all([api.getSensorGis(), api.getTaskGis()])
        cacheSensors = asList((sRes.data as { features?: unknown })?.features ?? sRes.data)
        cacheTasks = asList((tRes.data as { features?: unknown })?.features ?? tRes.data)
      }
    } catch {
      /* 保留现有缓存 */
    }
    shellFilters.sensorType = ''
    shellFilters.sensorStatus = ''
    shellFilters.taskStatus = ''
    shellFilters.taskId = ''
    setShellVisibility({ showSensors: true, showData: false, showTasks: true })
    // 不强制全量 rerender；连线图层独立叠加
    applyVisibility()
  }

  await removeDataSourceByName('assoc-links')

  const from = taskLonLat(taskId)
  if (!from) {
    shellStatus.value = `任务 #${taskId} 无空间范围，无法绘制关联线`
    return 0
  }

  const drawn: Array<{
    id: string
    fromLon: number
    fromLat: number
    toLon: number
    toLat: number
    name?: string
    description?: string
    mode?: AssocLinkMode
    score?: number
  }> = []

  const seen = new Set<string>()
  for (const link of links) {
    let to = sensorLonLat(link.platformId)
    if (!to) {
      // 软加载后再尝试一次。
      try {
        const res = await api.getSensorGis()
        cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
    /* 忽略异常 */
      }
      to = sensorLonLat(link.platformId)
    }
    if (!to) continue
    const mode = link.mode || 'candidate'
    const eid = `${taskId}-${link.platformId}-${mode}`
    if (seen.has(eid)) continue
    seen.add(eid)
    drawn.push({
      id: eid,
      fromLon: from[0],
      fromLat: from[1],
      toLon: to[0],
      toLat: to[1],
      name: link.name || `关联→${link.platformId}`,
      description: [
        `任务ID: ${taskId}`,
        `平台ID: ${link.platformId}`,
        `模式: ${mode}`,
        `评分: ${link.score ?? '-'}`,
        link.reason ? `说明: ${link.reason}` : '',
      ]
        .filter(Boolean)
        .join('<br/>'),
      mode,
      score: link.score,
    })
  }

  if (!drawn.length) {
    shellStatus.value = '无可绘制的关联连线（缺少传感器坐标）'
    return 0
  }

  const ds = await loadAssociationLinksLayer(viewer, drawn)
  dataSources.push(ds)
  applyVisibility()
  shellStatus.value = `已绘制关联连线 ${drawn.length} 条`
  if (options?.fit !== false) void fitShellView()
  return drawn.length
}

/** 聚焦离线或故障传感器，用于首页告警。 */
export async function focusAlertSensors() {
  await reloadShellLayers('/resources', {})
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  await fitShellView()
  shellStatus.value = `告警关注：离线 ${shellAlerts.offlineSensors} · 故障/维护 ${shellAlerts.faultSensors}`
}

/** 显示数据图层，用于查看质量问题。 */
export async function focusAnomalousData() {
  await showShellAndFit('data', '/data')
  shellStatus.value = `数据质量关注：异常 ${shellAlerts.anomalousData} · 已上图数据 ${shellCounts.data}`
}

export function focusLonLat(lon: number, lat: number, height = 180000) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    duration: 1.0,
  })
  shellStatus.value = `已定位到 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

export async function copyTextToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      shellStatus.value = '已复制到剪贴板'
      return true
    }
  } catch {
    /* 继续执行后续分支 */
  }
  shellStatus.value = '复制失败，请手动复制'
  return false
}
