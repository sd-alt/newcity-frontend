<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MapLegendIcon from './MapLegendIcon.vue'
import type { BasemapKey } from '../gis/mapConfig'
import type { MapSymbolKind } from '../gis/mapSymbols'
import {
  closeShellBubble,
  closeShellContextMenu,
  copyTextToClipboard,
  destroyShellViewer,
  ensureShellViewer,
  fitShellView,
  focusLonLat,
  reloadShellLayers,
  resetShellView,
  parseEntityBizId,
  selectShellFeature,
  setShellBasemap,
  setShellVisibility,
  shellBasemap,
  shellBubbleOpen,
  shellContextMenu,
  shellCounts,
  shellError,
  shellFilters,
  shellLoading,
  shellPickScreen,
  shellSelected,
  shellStatus,
  shellViewer,
  shellRightOpen,
  satelliteClock,
  satelliteClockMultipliers,
  resetSatelliteClock,
  setSatelliteClockMultiplier,
  setSatelliteClockPlaying,
  toggleShellRight,
  type ShellFeatureKind,
} from '../gis/mapShell'
import {
  clearMapDrawings,
  mapBoxSelectResult,
  mapDrawGeometry,
  mapToolMessage,
  mapToolMode,
  setMapToolMode,
  type MapToolMode,
} from '../gis/mapTools'

defineProps<{ showHomeCards?: boolean }>()
const route = useRoute()
const router = useRouter()
let host: HTMLDivElement | null = null
type MapFloatPanel = 'none' | 'basemap' | 'legend' | 'layers' | 'planning'
type PlanningMapAction =
  | 'tasks'
  | 'candidates'
  | 'basic'
  | 'optimized'
  | 'supplement'
  | 'coverage'
  | 'clear-links'
  | 'clear-coverage'

const panel = ref<MapFloatPanel>('none')
const toolsExpanded = ref(false)
const satelliteClockPanelOpen = ref(false)
const planningToolsVisible = computed(() => route.path === '/business' || route.path === '/planning')

const basemapOptions: Array<{ key: BasemapKey; label: string }> = [
  { key: 'vector', label: '标准地图' },
  { key: 'imagery', label: '卫星影像' },
  { key: 'terrain', label: '地形地图' },
  { key: 'admin', label: '行政区划' },
]

type LegendItem = {
  kind: MapSymbolKind
  label: string
  color: string
  shape?: 'point' | 'line' | 'area'
}
const legendSections: Array<{ title: string; items: LegendItem[] }> = [
  {
    title: '点对象',
    items: [
      { kind: 'satellite', label: '卫星', color: '#64748B' },
      { kind: 'uav', label: '无人机', color: '#64748B' },
      { kind: 'station', label: '地面站', color: '#64748B' },
      { kind: 'vehicle', label: '移动平台', color: '#64748B' },
      { kind: 'sensor', label: '其他传感资源', color: '#64748B' },
      { kind: 'data', label: '监测数据', color: '#1677FF' },
      { kind: 'task', label: '任务点位', color: '#0F3D66' },
      { kind: 'target', label: '任务目标', color: '#7C3AED' },
    ],
  },
  {
    title: '范围与连线',
    items: [
      { kind: 'task', label: '观测任务范围', color: '#0F3D66', shape: 'area' },
      { kind: 'indicator', label: '指标实例范围', color: '#BE123C', shape: 'area' },
      { kind: 'coverage', label: '资源覆盖范围', color: '#16A34A', shape: 'area' },
      { kind: 'satellite', label: '预测幅宽覆盖（近似）', color: '#38BDF8', shape: 'area' },
      { kind: 'algorithm', label: '算法结果范围', color: '#C2410C', shape: 'area' },
      { kind: 'association', label: '资源关联', color: '#64748B', shape: 'line' },
      { kind: 'satellite', label: '卫星 TLE/SGP4 准实时轨道预测', color: '#38BDF8', shape: 'line' },
      { kind: 'uav', label: '无人机飞行轨迹', color: '#14B8A6', shape: 'line' },
    ],
  },
]
const legendStatuses = [
  { label: '正常 / 在线', color: '#22C55E' },
  { label: '运行 / 数据正常', color: '#1677FF' },
  { label: '维护 / 告警', color: '#F59E0B' },
  { label: '故障 / 失败', color: '#EF4444' },
  { label: '离线 / 待开始', color: '#94A3B8' },
]

const bubbleStyle = computed(() => {
  const p = shellPickScreen.value
  if (!p) return { display: 'none' as const }
  const box = host || (document.querySelector('.map-basemap') as HTMLDivElement | null)
  if (!box) return { display: 'none' as const }
  // 避开地图右侧工具，并打开详情抽屉。
  const padX = 12
  const padTop = 8
  const bubbleW = 240
  const toolCol = 100 // 2-col toolbar width + gap
  const shell = document.querySelector('.app-shell') as HTMLElement | null
  const drawerOpen = !!shell?.classList.contains('right-open')
  let drawerW = 0
  if (drawerOpen && shell) {
    const raw = getComputedStyle(shell).getPropertyValue('--drawer-w').trim()
    const n = parseFloat(raw)
    drawerW = Number.isFinite(n) ? n + 20 : 380
  }
  const rightReserve = toolCol + drawerW
  let x = p.x
  let y = p.y - 14 // sit just above the point / arrow tip
  const minX = padX + bubbleW / 2
  const maxX = Math.max(minX, box.clientWidth - padX - bubbleW / 2 - rightReserve)
  const minY = padTop + 24
  const maxY = Math.max(minY, box.clientHeight - 24)
  x = Math.min(Math.max(x, minX), maxX)
  y = Math.min(Math.max(y, minY), maxY)
  return {
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -100%)',
  }
})

async function boot() {
  await nextTick()
  if (!host) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await nextTick()
  }
  if (!host) {
    shellError.value = '地图容器未就绪，请刷新页面重试'
    return
  }
  try {
    await ensureShellViewer(host)
    await reloadShellLayers(route.path, route.query as Record<string, unknown>)
  } catch (err) {
    shellError.value = err instanceof Error ? err.message : '地图初始化失败'
  }
}

async function retryLayers() {
  if (!host) return
  if (!shellViewer.value || shellViewer.value.isDestroyed()) await ensureShellViewer(host)
  await reloadShellLayers(route.path, route.query as Record<string, unknown>)
}

async function switchBasemap(key: BasemapKey) {
  await setShellBasemap(key)
  panel.value = 'none'
}

async function useFallbackBasemap() {
  await setShellBasemap('vector')
  panel.value = 'none'
  await retryLayers()
}

function zoomIn() {
  const v = shellViewer.value
  if (!v || v.isDestroyed()) return
  v.camera.zoomIn(v.camera.positionCartographic.height * 0.3)
}
function zoomOut() {
  const v = shellViewer.value
  if (!v || v.isDestroyed()) return
  v.camera.zoomOut(v.camera.positionCartographic.height * 0.3)
}
function goFullscreen() {
  const el = host?.closest('.map-main') || host?.parentElement
  if (!el) return
  if (document.fullscreenElement) void document.exitFullscreen()
  else void (el as HTMLElement).requestFullscreen?.()
}
function togglePanel(name: Exclude<MapFloatPanel, 'none'>) {
  satelliteClockPanelOpen.value = false
  panel.value = panel.value === name ? 'none' : name
}

function runPlanningMapAction(action: PlanningMapAction) {
  window.dispatchEvent(new CustomEvent<PlanningMapAction>('newcity:planning-map-action', { detail: action }))
}
function activateTool(mode: MapToolMode) {
  satelliteClockPanelOpen.value = false
  panel.value = 'none'
  const v = shellViewer.value
  if (!v) return
  if (mapToolMode.value === mode) {
    setMapToolMode(v, 'none')
    return
  }
  setMapToolMode(v, mode)
}
function clearAll() {
  clearMapDrawings(shellViewer.value)
  mapToolMessage.value = '已清除绘制与测量'
}
function closeBubble() {
  closeShellBubble()
}
function toggleLayer(key: 'showSensors' | 'showData' | 'showTasks' | 'showIndicators', on: boolean) {
  setShellVisibility({ [key]: on })
}

function formatSatelliteClockTime(value: number | null) {
  if (!Number.isFinite(value)) return '--'
  return new Date(value as number).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function toggleSatelliteClock() {
  setSatelliteClockPlaying(!satelliteClock.playing)
}

function toggleSatelliteClockPanel() {
  panel.value = 'none'
  satelliteClockPanelOpen.value = !satelliteClockPanelOpen.value
}

function closeSatelliteClockPanel() {
  satelliteClockPanelOpen.value = false
}



const ctxStyle = computed(() => {
  const m = shellContextMenu.value
  if (!m || !host) return { display: 'none' as const }
  const maxX = Math.max(20, host.clientWidth - 200)
  const maxY = Math.max(20, host.clientHeight - 220)
  const x = Math.min(Math.max(m.x, 8), maxX)
  const y = Math.min(Math.max(m.y, 8), maxY)
  return { left: x + 'px', top: y + 'px' }
})

function ctxKindLabel(kind: string) {
  if (kind === 'sensor') return '传感器'
  if (kind === 'data') return '监测数据'
  if (kind === 'task') return '观测任务'
  if (kind === 'indicator') return '指标实例'
  if (kind === 'blank') return '地图空白'
  return kind
}

async function ctxViewDetail() {
  const m = shellContextMenu.value
  if (!m || m.kind === 'blank' || !m.id) {
    closeShellContextMenu()
    return
  }
  await selectShellFeature(m.kind as ShellFeatureKind, m.id, { openBubble: true, fly: true })
  closeShellContextMenu()
}

async function ctxLocateHere() {
  const m = shellContextMenu.value
  if (!m || m.lon == null || m.lat == null) {
    closeShellContextMenu()
    return
  }
  focusLonLat(m.lon, m.lat)
  closeShellContextMenu()
}

async function ctxCopyCoord() {
  const m = shellContextMenu.value
  if (!m || m.lon == null || m.lat == null) {
    closeShellContextMenu()
    return
  }
  await copyTextToClipboard(`${m.lon.toFixed(6)}, ${m.lat.toFixed(6)}`)
  closeShellContextMenu()
}

function ctxDrawObservationArea() {
  closeShellContextMenu()
  activateTool('draw-polygon')
  mapToolMessage.value = '请在地图绘制观测区域，双击结束'
}

function ctxNewSensorAt() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  const q: Record<string, string> = { tab: 'crud' }
  if (m?.lon != null && m.lat != null) {
    q.lon = String(m.lon)
    q.lat = String(m.lat)
    mapToolMessage.value = `已带入坐标 ${m.lon.toFixed(4)}, ${m.lat.toFixed(4)}，可直接创建或再绘点微调`
  } else {
    mapToolMessage.value = '点击地图确定传感器位置'
    activateTool('draw-point')
  }
  void router.push({ path: '/resources', query: q })
  if (m?.lon == null) activateTool('draw-point')
}

function ctxNewTaskAt() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  const q: Record<string, string> = { tab: 'flow' }
  if (m?.lon != null && m.lat != null) {
    q.lon = String(m.lon)
    q.lat = String(m.lat)
  }
  void router.push({ path: '/planning', query: q })
  activateTool('draw-polygon')
  mapToolMessage.value = '绘制任务目标区域后，在规划中心点“写入地图绘制范围”'
}

async function ctxNearbyResources() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  if (m?.lon != null && m.lat != null) focusLonLat(m.lon, m.lat, 120000)
  await router.push({ path: '/resources', query: { tab: 'viz' } })
  mapToolMessage.value = '已切换到传感资源视图，可查看周边资源'
}

async function ctxViewCoverage() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || m.kind !== 'sensor' || !m.id) return
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  await selectShellFeature('sensor', m.id, { openBubble: true, fly: true })
  mapToolMessage.value = '已定位传感器并显示覆盖相关图层'
}

async function ctxViewRecentData() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || m.kind !== 'sensor' || !m.id) return
  await router.push({ path: '/data', query: { tab: 'query', sensorId: m.id } })
  setShellVisibility({ showSensors: true, showData: true, showTasks: false })
  mapToolMessage.value = '已跳转监测数据查询'
}

async function ctxViewRelatedTasks() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || !m.id) return
  if (m.kind === 'sensor') {
    await router.push({ path: '/planning', query: { tab: 'tasks' } })
    mapToolMessage.value = '请在观测规划中查看关联任务'
  } else if (m.kind === 'indicator') {
    await router.push({ path: '/planning', query: { tab: 'tasks' } })
  }
}

async function ctxEnterPlanningWorkbench() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  const q: Record<string, string> = { tab: 'flow' }
  if (m?.kind === 'task' && m.id) q.taskId = m.id
  await router.push({ path: '/planning', query: q })
  if (m?.kind === 'task' && m.id) {
    await selectShellFeature('task', m.id, { openBubble: true, fly: true })
  }
}

async function ctxViewPlanCandidates() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || m.kind !== 'task' || !m.id) return
  await router.push({ path: '/planning', query: { tab: 'candidates', taskId: m.id } })
  await selectShellFeature('task', m.id, { openBubble: true, fly: true })
}

async function ctxViewRelatedIndicators() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || m.kind !== 'task' || !m.id) return
  await router.push({ path: '/indicators', query: { tab: 'instances' } })
  mapToolMessage.value = '已打开指标实例，可对照任务关联指标'
}

async function ctxJumpCenter() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m || m.kind === 'blank') return
  if (m.kind === 'sensor') await router.push({ path: '/resources', query: { tab: 'crud' } })
  else if (m.kind === 'data') await router.push({ path: '/data', query: { tab: 'query' } })
  else if (m.kind === 'task') await router.push({ path: '/planning', query: { tab: 'tasks' } })
  else if (m.kind === 'indicator') await router.push({ path: '/indicators', query: { tab: 'instances' } })
  if (m.id) await selectShellFeature(m.kind as ShellFeatureKind, m.id, { openBubble: true, fly: true })
}

async function ctxOnlyThisLayer() {
  const m = shellContextMenu.value
  closeShellContextMenu()
  if (!m) return
  if (m.kind === 'sensor') setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  else if (m.kind === 'data') setShellVisibility({ showSensors: false, showData: true, showTasks: false })
  else if (m.kind === 'task') setShellVisibility({ showSensors: false, showData: false, showTasks: true })
  else setShellVisibility({ showSensors: true, showData: true, showTasks: true })
}

onMounted(() => {
  void boot()
  const onDoc = () => closeShellContextMenu()
  document.addEventListener('click', onDoc)
  onBeforeUnmount(() => document.removeEventListener('click', onDoc))
})

watch(
  () => [route.path, route.query.tab, route.query.taskId],
  () => {
    // 路由图层刷新由 AppLayout 统一触发，这里只关闭气泡避免残留
    closeShellBubble()
    panel.value = 'none'
    satelliteClockPanelOpen.value = false
  },
)

watch(
  () => satelliteClock.available,
  (available) => {
    if (!available) satelliteClockPanelOpen.value = false
  },
)

watch(mapBoxSelectResult, async (res) => {
  if (!res || !res.entityIds.length) return
  // 优先选择第一个可选业务实体，尽量跳过热力图和关联辅助实体。
  let picked: { kind: ShellFeatureKind; id: string } | null = null
  for (const eid of res.entityIds) {
    const parsed = parseEntityBizId(String(eid))
    if (parsed.id && ['sensor', 'data', 'task', 'indicator'].includes(parsed.kind)) {
      // 忽略末尾没有数字或业务 ID 的纯几何辅助实体。
      if (String(parsed.id).startsWith('heat')) continue
      if (String(eid).startsWith('assoc-link-')) continue
      if (String(eid).startsWith('data-heat-')) continue
      picked = parsed
      break
    }
  }
  if (!picked) {
    mapToolMessage.value = `框选到 ${res.count} 个要素`
    return
  }
  const ok = await selectShellFeature(picked.kind, picked.id, { openBubble: true, fly: false })
  mapToolMessage.value = ok
    ? `框选 ${res.count} 个，已选中${picked.kind} #${picked.id}`
    : `框选到 ${res.count} 个要素`
})

onBeforeUnmount(() => {
  clearMapDrawings(shellViewer.value)
  destroyShellViewer()
})

function setHost(el: unknown) {
  host = el instanceof HTMLElement ? (el as HTMLDivElement) : null
}
</script>

<template>
  <div class="map-basemap" :class="{ 'is-loading': shellLoading, 'tool-active': mapToolMode !== 'none' }">
    <div class="map-basemap-host" :ref="setHost"></div>

    <div class="map-tool-rail" aria-label="地图工具栏">
      <div class="map-toolbar" aria-label="地图工具">
        <div class="map-tool-group" aria-label="视图控制">
          <button type="button" class="map-tool" title="放大" aria-label="放大" @click="zoomIn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7v7M7 10.5h7"/></svg>
          </button>
          <button type="button" class="map-tool" title="缩小" aria-label="缩小" @click="zoomOut">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7 10.5h7"/></svg>
          </button>
          <button type="button" class="map-tool" title="复位到默认视角" aria-label="复位到默认视角" @click="resetShellView">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 5v6h6"/></svg>
          </button>
          <button type="button" class="map-tool" title="适应当前图层" aria-label="适应当前图层" @click="fitShellView">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
          </button>
        </div>
        <div class="map-tool-group" aria-label="地图内容">
          <button type="button" class="map-tool" :class="{ active: panel === 'basemap' }" title="切换底图" aria-label="切换底图" @click="togglePanel('basemap')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></svg>
          </button>
          <button type="button" class="map-tool" :class="{ active: panel === 'layers' }" title="业务图层" aria-label="业务图层" @click="togglePanel('layers')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>
          </button>
          <button v-if="planningToolsVisible" type="button" class="map-tool" :class="{ active: panel === 'planning' }" title="规划上图工具" aria-label="规划上图工具" @click="togglePanel('planning')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 8.5 10.5 16M16 8.5 13.5 16M8 7h8"/></svg>
          </button>
        </div>
        <div class="map-tool-group" aria-label="轨道模拟">
          <button
            type="button"
            class="map-tool map-tool-orbit"
            :class="{ active: satelliteClockPanelOpen, playing: satelliteClock.playing && satelliteClock.available }"
            :title="satelliteClock.available ? '轨道模拟设置' : '轨道模拟（暂无可用轨道）'"
            aria-label="轨道模拟设置"
            :aria-expanded="satelliteClockPanelOpen"
            @click="toggleSatelliteClockPanel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="3.8" transform="rotate(-28 12 12)"/><ellipse cx="12" cy="12" rx="8.5" ry="3.8" transform="rotate(28 12 12)"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>
            <span v-if="satelliteClock.playing && satelliteClock.available" class="map-tool-status-dot" aria-hidden="true"></span>
          </button>
        </div>
        <div class="map-tool-group" aria-label="辅助工具">
          <button type="button" class="map-tool" :class="{ active: panel === 'legend' }" title="查看图例" aria-label="查看图例" @click="togglePanel('legend')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="6" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="18" r="1.5"/><path d="M9 6h11M9 12h11M9 18h11"/></svg>
          </button>
          <button type="button" class="map-tool" :class="{ active: toolsExpanded }" :title="toolsExpanded ? '收起地图工具' : '更多地图工具'" :aria-label="toolsExpanded ? '收起地图工具' : '更多地图工具'" :aria-expanded="toolsExpanded" @click="toolsExpanded = !toolsExpanded">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="10" cy="17" r="1.5"/></svg>
          </button>
        </div>
        <template v-if="toolsExpanded">
        <div class="map-tool-group" aria-label="测量">
          <button type="button" class="map-tool" :class="{ active: mapToolMode === 'measure-line' }" title="测量距离" aria-label="测量距离" @click="activateTool('measure-line')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 12-12 4 4L8 20H4Z"/><path d="m13 7 4 4M10 10l2 2M7 13l2 2"/></svg>
          </button>
          <button type="button" class="map-tool" :class="{ active: mapToolMode === 'measure-area' }" title="测量面积" aria-label="测量面积" @click="activateTool('measure-area')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 3-13 11 4-4 10Z"/><circle cx="8" cy="6" r="1"/><circle cx="19" cy="10" r="1"/><circle cx="15" cy="20" r="1"/><circle cx="5" cy="19" r="1"/></svg>
          </button>
        </div>
        <div class="map-tool-group" aria-label="绘制与选择">
          <button type="button" class="map-tool" :class="{ active: mapToolMode === 'draw-point' }" title="绘制点位" aria-label="绘制点位" @click="activateTool('draw-point')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>
          </button>
          <button type="button" class="map-tool" :class="{ active: mapToolMode === 'draw-polygon' }" title="绘制区域" aria-label="绘制区域" @click="activateTool('draw-polygon')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 18 3-12 11 3-3 11Z"/><circle cx="8" cy="6" r="1.5"/><circle cx="19" cy="9" r="1.5"/><circle cx="16" cy="20" r="1.5"/><circle cx="5" cy="18" r="1.5"/></svg>
          </button>
          <button type="button" class="map-tool" :class="{ active: mapToolMode === 'box-select' }" title="框选地图对象" aria-label="框选地图对象" @click="activateTool('box-select')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 9h6v6H9z"/></svg>
          </button>
        </div>
        <div class="map-tool-group" aria-label="地图操作">
          <button type="button" class="map-tool" title="清除绘制和测量" aria-label="清除绘制和测量" @click="clearAll">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
          </button>
          <button type="button" class="map-tool" title="刷新地图图层" aria-label="刷新地图图层" :disabled="shellLoading" @click="retryLayers">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.5 10A7 7 0 0 0 6 7.5L4 11M5.5 14A7 7 0 0 0 18 16.5l2-3.5"/></svg>
          </button>
          <button type="button" class="map-tool" title="全屏地图" aria-label="全屏地图" @click="goFullscreen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
          </button>
        </div>
        </template>
      </div>
    </div>
    <button
      type="button"
      class="map-tool map-tool-detail"
      :class="{ active: shellRightOpen }"
      title="详情面板"
      aria-label="详情"
      @click="toggleShellRight"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM14 4v16"/><path d="M17 9h.01M17 12h.01M17 15h.01"/></svg>
    </button>

    <div v-if="satelliteClockPanelOpen" class="map-clock-controls map-clock-popover" aria-label="卫星轨道模拟控制" @click.stop>
      <div class="map-clock-heading">
        <div>
          <strong>轨道模拟</strong>
          <span class="map-clock-subtitle">{{ satelliteClock.available ? '实时轨道时间' : '等待轨道数据' }}</span>
        </div>
        <button type="button" class="map-clock-close" title="关闭设置" aria-label="关闭轨道模拟设置" @click="closeSatelliteClockPanel">×</button>
      </div>
      <template v-if="satelliteClock.available">
        <div class="map-clock-current">
          <span>模拟时间</span>
          <time>{{ formatSatelliteClockTime(satelliteClock.currentTimeMs) }}</time>
        </div>
        <div class="map-clock-setting">
          <span>自动播放轨道</span>
          <button
            type="button"
            class="map-clock-switch"
            role="switch"
            :aria-checked="satelliteClock.playing"
            :aria-label="satelliteClock.playing ? '暂停自动播放轨道' : '开始自动播放轨道'"
            @click="toggleSatelliteClock"
          >
            <span aria-hidden="true"></span>
          </button>
        </div>
        <div class="map-clock-actions">
          <button type="button" class="map-clock-button map-clock-reset" title="回到当前" aria-label="回到当前" @click="resetSatelliteClock">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 5v6h6"/></svg>
            <span>回到当前</span>
          </button>
          <div class="map-clock-speeds" role="group" aria-label="播放速度">
            <button
              v-for="speed in satelliteClockMultipliers"
              :key="speed"
              type="button"
              :class="{ active: satelliteClock.multiplier === speed }"
              :aria-pressed="satelliteClock.multiplier === speed"
              @click="setSatelliteClockMultiplier(speed)"
            >{{ speed }}x</button>
          </div>
        </div>
      </template>
      <p v-else class="map-clock-empty">当前没有可用的卫星动态轨道数据。加载带有 TLE/SGP4 预测信息的卫星资源后，这里会自动开放播放控制。</p>
    </div>

    <div v-if="panel === 'basemap'" class="map-float-panel">
      <div class="map-float-title">底图切换</div>
      <button
        v-for="opt in basemapOptions"
        :key="opt.key"
        type="button"
        class="map-float-item"
        :class="{ active: shellBasemap === opt.key }"
        @click="switchBasemap(opt.key)"
      >
        {{ opt.label }}
      </button>
    </div>
    <div v-if="panel === 'layers'" class="map-float-panel">
      <div class="map-float-title">业务图层</div>
      <label class="map-float-item check">
        <input type="checkbox" :checked="shellFilters.showSensors" @change="toggleLayer('showSensors', ($event.target as HTMLInputElement).checked)" />
        传感器（{{ shellCounts.sensors }}）
      </label>
      <label class="map-float-item check">
        <input type="checkbox" :checked="shellFilters.showData" @change="toggleLayer('showData', ($event.target as HTMLInputElement).checked)" />
        监测数据（{{ shellCounts.data }}）
      </label>
      <label class="map-float-item check">
        <input type="checkbox" :checked="shellFilters.showTasks" @change="toggleLayer('showTasks', ($event.target as HTMLInputElement).checked)" />
        观测任务（{{ shellCounts.tasks }}）
      </label>
        <label class="map-float-item">
          <input type="checkbox" :checked="shellFilters.showIndicators" @change="toggleLayer('showIndicators', ($event.target as HTMLInputElement).checked)" />
          指标实例 <span class="muted">{{ shellCounts.indicators }}</span>
        </label>
    </div>
    <div v-if="panel === 'planning' && planningToolsVisible" class="map-float-panel map-planning-panel" aria-label="规划上图工具">
      <div class="map-float-title">规划上图</div>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('tasks')">任务与资源</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('candidates')">候选资源</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('basic')">基础关联</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('optimized')">优化关联</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('supplement')">增补关联</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('coverage')">覆盖与缺口</button>
      <div class="map-planning-separator" />
      <button type="button" class="map-float-item" @click="runPlanningMapAction('clear-links')">清除关联线</button>
      <button type="button" class="map-float-item" @click="runPlanningMapAction('clear-coverage')">清除覆盖</button>
    </div>
    <div v-if="panel === 'legend'" class="map-float-panel map-legend-panel">
      <div class="map-float-title">图例</div>
      <section v-for="section in legendSections" :key="section.title" class="map-legend-section">
        <h4>{{ section.title }}</h4>
        <div class="map-legend-grid">
          <div v-for="item in section.items" :key="item.kind" class="map-float-item static map-legend-item">
            <MapLegendIcon :kind="item.kind" :color="item.color" :shape="item.shape" />
            <span>{{ item.label }}</span>
          </div>
        </div>
      </section>
      <section class="map-legend-section">
        <h4>运行状态</h4>
        <div class="map-legend-status-grid">
          <div v-for="item in legendStatuses" :key="item.label" class="map-legend-status">
            <i :style="{ backgroundColor: item.color }" />
            <span>{{ item.label }}</span>
          </div>
        </div>
      </section>
      <p class="map-float-hint">图形区分对象类型，颜色表示状态；点击数字标记可放大并查看对象，同坐标记录会保持聚合。</p>
    </div>

    <div class="map-hud-bottom">
      <span class="map-pill">{{ shellLoading ? '图层加载中…' : (shellStatus || ('底图就绪 · 传感' + shellCounts.sensors + ' / 数据' + shellCounts.data + ' / 任务' + shellCounts.tasks + ' / 指标' + shellCounts.indicators)) }}</span>
      <span v-if="mapToolMessage" class="map-pill">{{ mapToolMessage }}</span>
      <span v-if="mapDrawGeometry" class="map-pill">绘制结果：{{ mapDrawGeometry.type }} 已就绪</span>
      <span v-if="shellError" class="map-pill danger">{{ shellError }}</span>
      <button v-if="shellError" type="button" class="map-pill action" @click="retryLayers">重试</button>
      <button v-if="shellError" type="button" class="map-pill action" @click="useFallbackBasemap">备用底图</button>
    </div>

    <div v-if="shellBubbleOpen && shellSelected && shellPickScreen" class="map-bubble" :style="bubbleStyle">
      <div class="map-bubble-arrow" />
      <div class="map-bubble-head">
        <strong>{{ shellSelected.name }}</strong>
        <button type="button" class="map-bubble-close" @click="closeBubble">×</button>
      </div>
      <pre class="map-bubble-body">{{ shellSelected.description || '（无属性）' }}</pre>
      <div class="map-bubble-foot">详情已同步至右侧抽屉</div>
    </div>

    <div
      v-if="shellContextMenu"
      class="map-ctx-menu"
      :style="ctxStyle"
      @click.stop
      @contextmenu.prevent
    >
      <div class="map-ctx-title">{{ ctxKindLabel(shellContextMenu.kind) }}</div>
      <div v-if="shellContextMenu.name" class="map-ctx-sub">{{ shellContextMenu.name }}</div>
      <div v-if="shellContextMenu.lon != null" class="map-ctx-sub">
        {{ shellContextMenu.lon.toFixed(5) }}, {{ shellContextMenu.lat?.toFixed(5) }}
      </div>
      <!-- 空白状态 -->
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxLocateHere">以此处为中心查询</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxDrawObservationArea">绘制观测区域</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNewSensorAt">新建传感器位置</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNewTaskAt">新建观测任务</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNearbyResources">查看周边资源</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxCopyCoord">复制坐标</button>

      <!-- 传感资源 -->
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看详情</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewCoverage">查看覆盖范围</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewRecentData">查看最近数据</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewRelatedTasks">查看关联任务</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxLocateHere">地图定位</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>

      <!-- 任务 -->
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看任务详情</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewRelatedIndicators">查看关联指标</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewPlanCandidates">查看候选资源</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxEnterPlanningWorkbench">进入规划工作台</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>

      <!-- 数据 / 指标 / 其他 -->
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看详情</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxOnlyThisLayer">仅显示该类图层</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxLocateHere">以此为中心</button>
      <button v-if="shellContextMenu.kind !== 'blank'" type="button" class="map-ctx-item" @click="ctxCopyCoord">复制坐标</button>
      <button type="button" class="map-ctx-item muted" @click="closeShellContextMenu">关闭</button>
    </div>
  </div>
</template>
