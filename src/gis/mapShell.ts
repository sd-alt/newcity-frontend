import { reactive, ref, shallowRef } from 'vue'
import * as Cesium from 'cesium'
import { mapToolMode } from './mapTools'
import type { CustomDataSource, Viewer } from 'cesium'
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
  /** data layer style: all | points | heat */
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


const dataSources: CustomDataSource[] = []
let pickHandler: Cesium.ScreenSpaceEventHandler | null = null
let cacheSensors: Array<Record<string, unknown>> = []
let cacheData: Array<Record<string, unknown>> = []
let cacheTasks: Array<Record<string, unknown>> = []
let cacheIndicators: Array<Record<string, unknown>> = []
let hasFittedView = false
let highlightedEntity: Cesium.Entity | null = null
let highlightRestore: (() => void) | null = null

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
  if (path.startsWith('/indicators')) return 'indicators'
  if (path.startsWith('/resources')) return 'resources'
  if (path.startsWith('/data')) return 'data'
  if (path.startsWith('/planning')) return 'planning'
  if (path.startsWith('/algorithms')) return 'algorithms'
  if (path.startsWith('/applications')) return 'applications'
  if (path.startsWith('/gis')) return 'gis'
  return 'home'
}

export async function ensureShellViewer(container: HTMLElement): Promise<Viewer> {
  await loadMapConfig()
  const current = shellViewer.value
  if (current && !current.isDestroyed()) return current
  const viewer = createViewer(container, shellBasemap.value)
  try {
    ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
  } catch {
    /* ignore */
  }
  shellViewer.value = viewer
  try {
    // 关闭默认双击缩放，避免与测距/绘面双击结束冲突
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  } catch {
    /* ignore */
  }
  bindPick(viewer)
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
  shellContextMenu.value = null
  pickHandler?.destroy()
  pickHandler = null
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  shellViewer.value = null
  dataSources.length = 0
  cacheSensors = []
  cacheData = []
  cacheTasks = []
  cacheIndicators = []
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
    /* ignore */
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
  if (kind === 'sensor') candidates.push(`sensor-${sid}`, `sensor-cov-${sid}`)
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


function getEntityWorldPosition(entity: Cesium.Entity, time = Cesium.JulianDate.now()): Cesium.Cartesian3 | null {
  try {
    if (entity.position) {
      const p = entity.position.getValue(time)
      if (p) return p
    }
  } catch {
    /* ignore */
  }
  // polygon / polyline: use bounding sphere center via hierarchy samples is heavy; try _position or polygon hierarchy first point
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
    /* ignore */
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
    /* ignore */
  }
  return null
}

/** Project entity world position to canvas pixel coordinates (relative to Cesium canvas). */
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
  // Allow slight offscreen; UI will clamp. Far offscreen => hide follow noise.
  // Keep projecting during camera fly; UI clamps bubble into host.
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
      /* ignore */
    }
    bubblePostRenderRemove = null
  }
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
  const spatialLine = descLines.find((l) => /WKT|POINT|POLYGON|LINESTRING|位置|研究区|覆盖/i.test(l))
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
  // Always prefer entity projected position so bubble anchors to the feature
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
    const entity = picked?.id as Cesium.Entity | undefined
    if (!entity || typeof entity !== 'object') {
      shellSelected.value = null
      shellPickScreen.value = null
      shellBubbleOpen.value = false
      shellBubbleEntity = null
      clearHighlight()
      return
    }
    // pass click as fallback; projection to entity point preferred inside selectFromEntity
    selectFromEntity(entity, { x: movement.position.x, y: movement.position.y }, true)
    // next frame re-anchor to true entity screen position
    requestAnimationFrame(() => updateShellBubbleScreen())
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  pickHandler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
    const picked = viewer.scene.pick(movement.position)
    const entity = picked?.id as Cesium.Entity | undefined
    openContextMenu(viewer, movement.position, entity && typeof entity === 'object' ? entity : null)
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

  try {
    viewer.scene.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  } catch {
    /* ignore */
  }
}


/** Ensure target kind is loaded/visible on map. Always refresh on force. */
async function ensureFeatureOnMap(kind: ShellFeatureKind, forceRefresh = false): Promise<void> {
  if (kind === 'sensor') {
    setShellVisibility({ showSensors: true })
    // Locate from list should not be blocked by left-panel filters.
    shellFilters.sensorType = ''
    shellFilters.sensorStatus = ''
    if (forceRefresh || !cacheSensors.length) {
      try {
        const res = await api.getSensorGis()
        cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
        /* ignore */
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
        /* ignore */
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
        /* ignore */
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
        /* ignore */
      }
    }
  } else {
    return
  }
  await rerenderShellLayers(false)
}

/** List/search -> map: fly, highlight, bubble, detail */
export async function selectShellFeature(
  kind: ShellFeatureKind,
  id: string | number,
  options?: { openBubble?: boolean; fly?: boolean },
): Promise<boolean> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return false
  const sid = String(id)

  // Always surface the target layer first so list/map selection is visible.
  if (kind === 'sensor') setShellVisibility({ showSensors: true })
  else if (kind === 'data') setShellVisibility({ showData: true })
  else if (kind === 'task') setShellVisibility({ showTasks: true })
  else if (kind === 'indicator') setShellVisibility({ showIndicators: true })

  let entity = findEntityByBiz(kind, sid)

  // Soft ensure: show layer and render from existing cache first.
  if (!entity && kind !== 'unknown') {
    await ensureFeatureOnMap(kind, false)
    entity = findEntityByBiz(kind, sid)
  }

  // Hard ensure: always re-fetch GIS when still missing (stale cache / wrong center).
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
  // Highlight first without depending on stale camera
  selectFromEntity(entity, null, openBubble)
  if (options?.fly !== false) {
    try {
      await viewer.flyTo(entity, { duration: 0.9 })
    } catch {
      /* ignore */
    }
    // After fly, re-project bubble onto the feature point
    requestAnimationFrame(() => {
      updateShellBubbleScreen()
      // second tick after render
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
  for (const ds of dataSources.splice(0)) {
    try {
      viewer.dataSources.remove(ds, true)
    } catch {
      /* ignore */
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
    else if (name === 'assoc-links') ds.show = shellFilters.showSensors || shellFilters.showTasks
    else if (name.startsWith('algo-')) ds.show = true
    else if (name.startsWith('planning-') || name.includes('coverage') || name.includes('gap')) ds.show = true
    else ds.show = true
  }
}

function filteredSensors() {
  const t = shellFilters.sensorType.trim().toLowerCase()
  const st = shellFilters.sensorStatus.trim().toLowerCase()
  return cacheSensors.filter((item) => {
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

export async function reloadShellLayers(path: string, query: Record<string, unknown> = {}) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  const center = centerFromPath(path)
  const gen = ++reloadGeneration
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
  await clearSources(viewer)
  shellCounts.sensors = 0
  shellCounts.data = 0
  shellCounts.tasks = 0
  shellCounts.indicators = 0
  shellAlerts.offlineSensors = 0
  shellAlerts.faultSensors = 0
  shellAlerts.failedTasks = 0
  shellAlerts.anomalousData = 0

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

    if (needSensors) {
      const res = await api.getSensorGis()
      cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
    } else {
      cacheSensors = []
    }
    if (needData) {
      const res = await api.getDataGis()
      cacheData = asList((res.data as { features?: unknown })?.features ?? res.data)
    } else {
      cacheData = []
    }
    if (needTasks) {
      const res = await api.getTaskGis()
      cacheTasks = asList((res.data as { features?: unknown })?.features ?? res.data)
      if (query.taskId) shellFilters.taskId = String(query.taskId)
    } else {
      cacheTasks = []
    }

    if (needSensors || shellFilters.showSensors) {
      const feats = filteredSensors()
      const ds = await loadSensorLayer(viewer, feats)
      dataSources.push(ds)
      shellCounts.sensors = feats.length
    }
    if (needData || shellFilters.showData) {
      const dataFeats = filteredData()
      const ds = await loadDataLayer(viewer, dataFeats)
      dataSources.push(ds)
      shellCounts.data = dataFeats.length
    }
    if (needTasks || shellFilters.showTasks) {
      const feats = filteredTasks()
      const ds = await loadTaskLayer(viewer, feats)
      dataSources.push(ds)
      shellCounts.tasks = feats.length
    }
    // 指标范围：感知指标中心为主，首页/综合/规划也展示以便业务串联
    if (
      center === 'indicators' ||
      center === 'home' ||
      center === 'applications' ||
      center === 'planning'
    ) {
      const res = await api.listInstances('?pageSize=100')
      const rows = asList(res.data).filter((r) => String(r.spatialWkt || r.geometryWkt || '').trim())
      cacheIndicators = rows
      const ds = await loadWktFeatureLayer(viewer, rows, {
        idPrefix: 'indicator',
        name: 'indicators',
        color: Cesium.Color.fromCssColorString('#be123c').withAlpha(0.75),
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
            String(item.spatialWkt || item.geometryWkt || '').trim()
              ? `范围WKT: ${String(item.spatialWkt || item.geometryWkt)}`
              : '',
          ]
            .filter(Boolean)
            .join('<br/>'),
      })
      dataSources.push(ds)
      shellCounts.indicators = rows.length
    } else {
      cacheIndicators = []
    }

    if (gen !== reloadGeneration) return
    recomputeAlerts()
    applyVisibility()
    if (!hasFittedView) {
      await flyToDataSources(viewer)
      if (gen !== reloadGeneration) return
      hasFittedView = true
    }
    const total =
      shellCounts.sensors + shellCounts.data + shellCounts.tasks + shellCounts.indicators
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
    flyToChina(viewer)
  } finally {
    if (safetyTimer) window.clearTimeout(safetyTimer)
    if (gen === reloadGeneration) shellLoading.value = false
  }
}

export async function rerenderShellLayers(fitView = true) {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return
  await clearSources(viewer)
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
        getWkt: (item) => String(item.spatialWkt || item.geometryWkt || ''),
        getName: (item) =>
          String(item.displayName || item.instanceName || item.name || item.code || item.id),
      }),
    )
    shellCounts.indicators = cacheIndicators.length
  }
  applyVisibility()
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
}

/** Update layer visibility and/or attribute filters, then optionally re-render features. */
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
  // 先按路由装载缓存图层，再强制可见性（避免被 center 默认上图策略覆盖）
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

// ---------- planning association map story ----------

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
        /* ignore */
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
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Planning workspace: tasks + sensors visible together */
export async function showPlanningWorkspace(path = '/planning') {
  await reloadShellLayers(path, {})
  setShellVisibility({ showSensors: true, showData: false, showTasks: true })
  await fitShellView()
  shellStatus.value = `规划工作台：任务 ${shellCounts.tasks} · 传感资源 ${shellCounts.sensors}`
}

/** Indicators workspace: instance ranges only */
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

/** 规划覆盖表达：任务区(蓝) + 已覆盖(绿) + 缺口(红) */
export async function drawPlanningCoverageOverlay(input: {
  taskWkt?: string
  coverageWkt?: string
  gapWkt?: string
  fit?: boolean
}): Promise<{ task: number; coverage: number; gap: number }> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return { task: 0, coverage: 0, gap: 0 }

  const task = await pushWktOverlay(
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
  inputWkt?: string
  resultWkt?: string
  fit?: boolean
  inputLabel?: string
  resultLabel?: string
}): Promise<number> {
  const viewer = shellViewer.value
  if (!viewer || viewer.isDestroyed()) return 0
  let n = 0
  n += await pushWktOverlay(
    'algo-input-area',
    'algo-in',
    String(input.inputWkt || ''),
    input.inputLabel || '算法输入区域',
    '#7C3AED',
    0.3,
  )
  n += await pushWktOverlay(
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
 * Draw task-sensor association lines on the map.
 * mode: candidate(gray) / basic(blue) / optimized(green) / supplement(orange)
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
      /* keep existing cache */
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
      // one more chance after soft ensure
      try {
        const res = await api.getSensorGis()
        cacheSensors = asList((res.data as { features?: unknown })?.features ?? res.data)
      } catch {
        /* ignore */
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

/** Focus offline/fault sensors for home alerts */
export async function focusAlertSensors() {
  await reloadShellLayers('/resources', {})
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  await fitShellView()
  shellStatus.value = `告警关注：离线 ${shellAlerts.offlineSensors} · 故障/维护 ${shellAlerts.faultSensors}`
}

/** Show data layer for quality attention */
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
    /* fallthrough */
  }
  shellStatus.value = '复制失败，请手动复制'
  return false
}
