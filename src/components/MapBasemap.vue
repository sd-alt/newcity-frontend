<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { BasemapKey } from '../gis/mapConfig'
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
const panel = ref<'none' | 'basemap' | 'legend' | 'layers'>('none')

const basemapOptions: Array<{ key: BasemapKey; label: string }> = [
  { key: 'vector', label: '标准地图' },
  { key: 'imagery', label: '卫星影像' },
  { key: 'terrain', label: '地形地图' },
  { key: 'admin', label: '行政区划' },
]

const bubbleStyle = computed(() => {
  const p = shellPickScreen.value
  if (!p) return { display: 'none' as const }
  const box = host || (document.querySelector('.map-basemap') as HTMLDivElement | null)
  if (!box) return { display: 'none' as const }
  // Anchor above the feature point; only clamp to keep bubble inside map host
  const padX = 12
  const padTop = 8
  const bubbleW = 240
  let x = p.x
  let y = p.y - 14 // sit just above the point / arrow tip
  const minX = padX + bubbleW / 2
  const maxX = Math.max(minX, box.clientWidth - padX - bubbleW / 2)
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
  if (!host) return
  await ensureShellViewer(host)
  await reloadShellLayers(route.path, route.query as Record<string, unknown>)
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
function togglePanel(name: 'basemap' | 'legend' | 'layers') {
  panel.value = panel.value === name ? 'none' : name
}
function activateTool(mode: MapToolMode) {
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
function toggleLayer(key: 'showSensors' | 'showData' | 'showTasks', on: boolean) {
  setShellVisibility({ [key]: on })
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
  void router.push({ path: '/resources', query: { tab: 'crud' } })
  activateTool('draw-point')
  if (m?.lon != null && m.lat != null) {
    mapToolMessage.value = `在 ${m.lon.toFixed(4)}, ${m.lat.toFixed(4)} 附近绘点创建传感器`
  } else {
    mapToolMessage.value = '点击地图确定传感器位置'
  }
}

function ctxNewTaskAt() {
  closeShellContextMenu()
  void router.push({ path: '/planning', query: { tab: 'tasks' } })
  activateTool('draw-polygon')
  mapToolMessage.value = '绘制任务目标区域后，可在规划中心写入空间范围'
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
  },
)

watch(mapBoxSelectResult, async (res) => {
  if (!res || !res.entityIds.length) return
  const first = res.entityIds[0]
  if (!first) return
  let kind: ShellFeatureKind = 'unknown'
  let id = first
  if (first.startsWith('sensor-cov-')) {
    kind = 'sensor'
    id = first.slice('sensor-cov-'.length)
  } else if (first.startsWith('sensor-')) {
    kind = 'sensor'
    id = first.slice('sensor-'.length)
  } else if (first.startsWith('data-heat-')) {
    kind = 'data'
    id = first.slice('data-heat-'.length)
  } else if (first.startsWith('data-')) {
    kind = 'data'
    id = first.slice('data-'.length)
  } else if (first.startsWith('task-')) {
    kind = 'task'
    id = first.slice('task-'.length)
  } else if (first.startsWith('indicator-')) {
    kind = 'indicator'
    id = first.slice('indicator-'.length)
  }
  await selectShellFeature(kind, id, { openBubble: true, fly: true })
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

    <div class="map-toolbar" aria-label="地图工具">
      <button type="button" class="map-tool" title="放大" @click="zoomIn">+</button>
      <button type="button" class="map-tool" title="缩小" @click="zoomOut">−</button>
      <button type="button" class="map-tool" title="复位" @click="resetShellView">定位</button>
      <button type="button" class="map-tool" title="适应" @click="fitShellView">适应</button>
      <button type="button" class="map-tool" :class="{ active: panel === 'basemap' }" title="底图" @click="togglePanel('basemap')">底图</button>
      <button type="button" class="map-tool" :class="{ active: panel === 'layers' }" title="图层" @click="togglePanel('layers')">图层</button>
      <button type="button" class="map-tool" :class="{ active: panel === 'legend' }" title="图例" @click="togglePanel('legend')">图例</button>
      <button type="button" class="map-tool" :class="{ active: mapToolMode === 'measure-line' }" title="测距" @click="activateTool('measure-line')">测距</button>
      <button type="button" class="map-tool" :class="{ active: mapToolMode === 'measure-area' }" title="测面" @click="activateTool('measure-area')">测面</button>
      <button type="button" class="map-tool" :class="{ active: mapToolMode === 'draw-point' }" title="绘点" @click="activateTool('draw-point')">绘点</button>
      <button type="button" class="map-tool" :class="{ active: mapToolMode === 'draw-polygon' }" title="绘面" @click="activateTool('draw-polygon')">绘面</button>
      <button type="button" class="map-tool" :class="{ active: mapToolMode === 'box-select' }" title="框选" @click="activateTool('box-select')">框选</button>
      <button type="button" class="map-tool" title="清除" @click="clearAll">清除</button>
      <button type="button" class="map-tool" title="刷新" :disabled="shellLoading" @click="retryLayers">刷新</button>
      <button type="button" class="map-tool" title="全屏" @click="goFullscreen">全屏</button>
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
      <div class="map-float-item static">指标实例：{{ shellCounts.indicators }}</div>
    </div>
    <div v-if="panel === 'legend'" class="map-float-panel">
      <div class="map-float-title">图例</div>
      <div class="map-float-item static"><i class="dot green" /> 传感器·在线</div>
      <div class="map-float-item static"><i class="dot gray" /> 传感器·离线</div>
      <div class="map-float-item static"><i class="dot red" /> 传感器·故障</div>
      <div class="map-float-item static"><i class="dot blue" /> 监测数据·正常</div>
      <div class="map-float-item static"><i class="dot orange" /> 监测数据·异常</div>
      <div class="map-float-item static"><i class="dot purple" /> 观测任务</div>
      <div class="map-float-item static"><i class="dot blue" /> 关联·候选</div>
      <div class="map-float-item static"><i class="dot green" /> 关联·基础</div>
      <div class="map-float-item static"><i class="dot orange" /> 关联·优化</div>
      <div class="map-float-item static"><i class="dot gray" /> 关联·增补</div>
      <div class="map-float-item static"><i class="dot blue" /> 指标范围</div>
      <div class="map-float-item static"><i class="dot blue" /> 任务目标区域</div>
      <div class="map-float-item static"><i class="dot green" /> 方案覆盖范围</div>
      <div class="map-float-item static"><i class="dot red" /> 覆盖缺口</div>
      <div class="map-float-item static"><i class="dot purple" /> 算法输入区域</div>
      <div class="map-float-item static"><i class="dot orange" /> 算法结果区域</div>
    </div>

    <div class="map-hud-bottom">
      <span class="map-pill">{{ shellLoading ? '图层加载中…' : shellStatus }}</span>
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
      <!-- blank -->
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxLocateHere">以此处为中心查询</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxDrawObservationArea">绘制观测区域</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNewSensorAt">新建传感器位置</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNewTaskAt">新建观测任务</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxNearbyResources">查看周边资源</button>
      <button v-if="shellContextMenu.kind === 'blank'" type="button" class="map-ctx-item" @click="ctxCopyCoord">复制坐标</button>

      <!-- sensor -->
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看详情</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewCoverage">查看覆盖范围</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewRecentData">查看最近数据</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxViewRelatedTasks">查看关联任务</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxLocateHere">地图定位</button>
      <button v-if="shellContextMenu.kind === 'sensor'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>

      <!-- task -->
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看任务详情</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewRelatedIndicators">查看关联指标</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxViewPlanCandidates">查看候选资源</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxEnterPlanningWorkbench">进入规划工作台</button>
      <button v-if="shellContextMenu.kind === 'task'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>

      <!-- data / indicator / other -->
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxViewDetail">查看详情</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxJumpCenter">进入所属中心</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxOnlyThisLayer">仅显示该类图层</button>
      <button v-if="shellContextMenu.kind === 'data' || shellContextMenu.kind === 'indicator'" type="button" class="map-ctx-item" @click="ctxLocateHere">以此为中心</button>
      <button v-if="shellContextMenu.kind !== 'blank'" type="button" class="map-ctx-item" @click="ctxCopyCoord">复制坐标</button>
      <button type="button" class="map-ctx-item muted" @click="closeShellContextMenu">关闭</button>
    </div>
  </div>
</template>
