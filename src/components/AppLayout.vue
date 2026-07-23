<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import MapBasemap from './MapBasemap.vue'
import {
  reloadShellLayers,
  selectShellFeature,
  updateShellBubbleScreen,
  setShellBasemap,
  shellBasemap,
  shellBubbleOpen,
  shellCounts,
  shellAlerts,
  shellPickScreen,
  shellSelected,
  shellViewer,
  type ShellFeatureKind,
} from '../gis/mapShell'
import { mapToolMessage } from '../gis/mapTools'
import type { BasemapKey } from '../gis/mapConfig'
import * as api from '../api/endpoints'

const { user, loading, logout } = useAuthStore()
const route = useRoute()
const router = useRouter()

const leftOpen = ref(true)
const rightOpen = ref(false)
const bottomOpen = ref(false)
const leftWidth = ref(320)
const basemapOpen = ref(false)
const searchQ = ref('')
const searchOpen = ref(false)
const searchLoading = ref(false)
const lastTabByCenter = ref<Record<string, string>>({})

const searchGroups = ref<
  Array<{ type: string; items: Array<{ id: string; title: string; subtitle: string; route: string; tab?: string }> }>
>([])

type SubItem = { key: string; label: string }
type CenterItem = {
  key: string
  label: string
  short: string
  icon: string
  to: string
  defaultTab: string
  children: SubItem[]
}

const centers: CenterItem[] = [
  {
    key: 'indicators',
    label: '感知指标中心',
    short: '感知指标',
    icon: '标',
    to: '/indicators',
    defaultTab: 'instances',
    children: [
      { key: 'samples', label: '指标样例' },
      { key: 'instances', label: '指标实例' },
      { key: 'tree', label: '指标树' },
      { key: 'query', label: '条件查询' },
      { key: 'versions', label: '版本管理' },
    ],
  },
  {
    key: 'resources',
    label: '传感资源中心',
    short: '传感资源',
    icon: '资',
    to: '/resources',
    defaultTab: 'crud',
    children: [
      { key: 'types', label: '传感器类型' },
      { key: 'crud', label: '传感器资源' },
      { key: 'query', label: '资源查询' },
      { key: 'viz', label: '资源地图' },
    ],
  },
  {
    key: 'data',
    label: '观测数据中心',
    short: '观测数据',
    icon: '数',
    to: '/data',
    defaultTab: 'query',
    children: [
      { key: 'crud', label: '数据模型' },
      { key: 'sources', label: '数据接入' },
      { key: 'query', label: '数据查询' },
      { key: 'viz', label: '数据地图' },
    ],
  },
  {
    key: 'planning',
    label: '观测规划中心',
    short: '观测规划',
    icon: '规',
    to: '/planning',
    defaultTab: 'tasks',
    children: [
      { key: 'tasks', label: '任务建模' },
      { key: 'flow', label: '需求与关联' },
      { key: 'candidates', label: '候选与评分' },
      { key: 'plans', label: '方案管理' },
    ],
  },
  {
    key: 'algorithms',
    label: '算法处理中心',
    short: '算法处理',
    icon: '算',
    to: '/algorithms',
    defaultTab: 'tasks',
    children: [
      { key: 'models', label: '算法模型' },
      { key: 'tasks', label: '处理任务' },
      { key: 'run', label: '任务执行' },
      { key: 'monitor', label: '过程监控' },
      { key: 'results', label: '处理结果' },
    ],
  },
  {
    key: 'applications',
    label: '综合应用中心',
    short: '综合应用',
    icon: '综',
    to: '/applications',
    defaultTab: 'gis',
    children: [
      { key: 'gis', label: 'GIS综合展示' },
      { key: 'stats', label: '综合统计' },
      { key: 'workbench', label: '工作台' },
    ],
  },
]

const basemaps: Array<{ key: BasemapKey; label: string }> = [
  { key: 'vector', label: '标准地图' },
  { key: 'imagery', label: '卫星影像' },
  { key: 'terrain', label: '地形地图' },
  { key: 'admin', label: '行政区划' },
]

const activeCenter = computed(() => {
  if (route.path === '/' || route.name === 'home') return null
  return centers.find((c) => route.path === c.to || route.path.startsWith(c.to + '/')) || null
})

const currentCenterLabel = computed(() => {
  if (!activeCenter.value) return '首页概览'
  return activeCenter.value.label
})

const pageLabel = computed(() => {
  if (!activeCenter.value) return '页面'
  const tab = String(route.query.tab || activeCenter.value.defaultTab)
  return activeCenter.value.children.find((c) => c.key === tab)?.label || '概览'
})

const subItems = computed(() => activeCenter.value?.children || [])

const activeSubKey = computed(() => {
  const q = String(route.query.tab || '')
  if (q && subItems.value.some((s) => s.key === q)) return q
  return activeCenter.value?.defaultTab || ''
})

const bottomSummary = computed(() => {
  const key = activeCenter.value?.key || 'home'
  if (key === 'indicators') return `指标实例 ${shellCounts.indicators} · 感知指标中心`
  if (key === 'resources') return `传感资源 ${shellCounts.sensors} · 离线 ${shellAlerts.offlineSensors} · 故障 ${shellAlerts.faultSensors}`
  if (key === 'data') return `监测数据 ${shellCounts.data} · 异常 ${shellAlerts.anomalousData}`
  if (key === 'planning') return `观测任务 ${shellCounts.tasks} · 失败 ${shellAlerts.failedTasks}`
  if (key === 'algorithms') return `算法处理 · 输入/结果图层联动`
  if (key === 'applications') return `综合应用 · 多中心图层叠加`
  return `传感器 ${shellCounts.sensors} · 数据 ${shellCounts.data} · 任务 ${shellCounts.tasks} · 指标 ${shellCounts.indicators}`
})

watch(
  () => route.fullPath,
  () => {
    searchOpen.value = false
    basemapOpen.value = false
    if (activeCenter.value && activeSubKey.value) {
      lastTabByCenter.value[activeCenter.value.key] = activeSubKey.value
    }
  },
)

// 仅中心路径切换时重载底图业务图层，避免二级菜单切换清空关联线/高亮
watch(
  () => {
    const path = route.path
    const tab = String(route.query.tab || '')
    return path.startsWith('/gis') ? path + '::' + tab : path
  },
  async () => {
    await reloadShellLayers(route.path, { tab: String(route.query.tab || '') })
  },
  { immediate: true },
)

watch(shellSelected, (v) => {
  if (v) rightOpen.value = true
})

watch(rightOpen, () => {
  // drawer open/close changes safe area for bubble and toolbar
  requestAnimationFrame(() => updateShellBubbleScreen())
  setTimeout(() => updateShellBubbleScreen(), 220)
})

function toggleLeft() {
  leftOpen.value = !leftOpen.value
}
function toggleRight() {
  rightOpen.value = !rightOpen.value
}
function closeRight() {
  rightOpen.value = false
}
function trayKindLabel(kind: unknown) {
  const k = String(kind || '')
  if (k === 'sensor') return '传感器'
  if (k === 'data') return '监测数据'
  if (k === 'task') return '观测任务'
  if (k === 'indicator') return '指标实例'
  return k || '对象'
}

function toggleBottom() {
  bottomOpen.value = !bottomOpen.value
}

function onLeftResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = leftWidth.value
  function move(e: MouseEvent) {
    leftWidth.value = Math.min(460, Math.max(280, startW + (e.clientX - startX)))
  }
  function up() {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

async function goHome() {
  await router.push('/')
}

async function goCenter(c: CenterItem) {
  const tab = lastTabByCenter.value[c.key] || c.defaultTab
  await router.push({ path: c.to, query: { tab } })
}

async function goSub(key: string) {
  if (!activeCenter.value) return
  await router.push({ path: activeCenter.value.to, query: { ...route.query, tab: key } })
}

function chooseBasemap(key: BasemapKey) {
  setShellBasemap(key)
  basemapOpen.value = false
}

function kindLabel(kind: ShellFeatureKind) {
  if (kind === 'sensor') return '传感器'
  if (kind === 'data') return '监测数据'
  if (kind === 'task') return '观测任务'
  if (kind === 'indicator') return '指标实例'
  if (kind === 'unknown') {
    const n = String(shellSelected.value?.name || '')
    if (n.includes('算法')) return '算法任务'
    return '业务对象'
  }
  return kind
}

async function jumpSelectedCenter() {
  const s = shellSelected.value
  if (!s) return
  if (s.kind === 'sensor') await router.push({ path: '/resources', query: { tab: 'crud' } })
  else if (s.kind === 'data') await router.push({ path: '/data', query: { tab: 'query' } })
  else if (s.kind === 'task') await router.push({ path: '/planning', query: { tab: 'tasks' } })
  else if (s.kind === 'indicator') await router.push({ path: '/indicators', query: { tab: 'instances' } })
  else await router.push({ path: '/algorithms', query: { tab: 'tasks' } })
}

function reflySelected() {
  const s = shellSelected.value
  if (!s) return
  if (s.kind === 'unknown') {
    const viewer = shellViewer.value
    if (viewer && !viewer.isDestroyed()) {
      shellPickScreen.value = {
        x: Math.round(viewer.scene.canvas.clientWidth * 0.5),
        y: Math.round(viewer.scene.canvas.clientHeight * 0.35),
      }
    } else if (!shellPickScreen.value) {
      shellPickScreen.value = { x: 320, y: 180 }
    }
    shellBubbleOpen.value = true
    rightOpen.value = true
    return
  }
  void selectShellFeature(s.kind, s.id, { openBubble: true, fly: true })
}

async function runSearch() {
  const q = searchQ.value.trim()
  if (!q) {
    searchGroups.value = []
    searchOpen.value = true
    return
  }
  searchLoading.value = true
  try {
    const groups: typeof searchGroups.value = []
    const qstr = `?search=${encodeURIComponent(q)}`
    const [sensors, data, tasks, instances] = await Promise.allSettled([
      api.listSensors(qstr),
      api.listObservationData(qstr),
      api.listTasks(),
      api.listInstances(qstr),
    ])

    function rows(r: PromiseSettledResult<any>): any[] {
      if (r.status !== 'fulfilled') return []
      const v = r.value
      if (Array.isArray(v)) return v
      if (v && Array.isArray(v.results)) return v.results
      return []
    }

    const sensorItems = rows(sensors).map((x: any) => ({
      id: String(x.id ?? x.platformId ?? x.platform_id ?? ''),
      title: String(x.name || x.platformName || x.code || x.id),
      subtitle: String(x.sensorType || x.type || x.status || '概览'),
      route: '/resources',
      tab: 'crud',
    }))
    if (sensorItems.length) groups.push({ type: '传感器', items: sensorItems })

    const dataItems = rows(data).map((x: any) => ({
      id: String(x.id),
      title: String(x.name || x.dataName || `监测数据 #${x.id}`),
      subtitle: String(x.qualityStatus || x.dataType || '概览'),
      route: '/data',
      tab: 'query',
    }))
    if (dataItems.length) groups.push({ type: '监测数据', items: dataItems })

    const taskItems = rows(tasks)
      .filter((x: any) => {
        const hay = `${x.name || ''} ${x.taskName || ''} ${x.id || ''}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .slice(0, 8)
      .map((x: any) => ({
      id: String(x.id),
      title: String(x.name || x.taskName || `监测数据 #${x.id}`),
      subtitle: String(x.status || '概览'),
      route: '/planning',
      tab: 'tasks',
    }))
    if (taskItems.length) groups.push({ type: '观测任务', items: taskItems })

    const indItems = rows(instances).map((x: any) => ({
      id: String(x.id),
      title: String(x.name || x.instanceName || `监测数据 #${x.id}`),
      subtitle: String(x.status || '概览'),
      route: '/indicators',
      tab: 'instances',
    }))
    if (indItems.length) groups.push({ type: '指标实例', items: indItems })

    searchGroups.value = groups
    searchOpen.value = true
  } finally {
    searchLoading.value = false
  }
}

async function openSearchItem(item: {
  id: string
  title: string
  subtitle: string
  route: string
  tab?: string
}) {
  searchOpen.value = false
  await router.push({ path: item.route, query: item.tab ? { tab: item.tab } : {} })
  if (item.route === '/resources') selectShellFeature('sensor', item.id)
  else if (item.route === '/data') selectShellFeature('data', item.id)
  else if (item.route === '/planning') selectShellFeature('task', item.id)
  else if (item.route === '/indicators') selectShellFeature('indicator', item.id)
  rightOpen.value = true
}

async function doLogout() {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'left-closed': !leftOpen,
      'right-open': rightOpen,
      'bottom-open': bottomOpen,
    }"
    :style="{ '--left-w': leftOpen ? leftWidth + 'px' : '0px' }"
  >
    <header class="topbar">
      <div class="topbar-left">
        <button type="button" class="sys-name" title="返回首页" @click="goHome">地学传感网智能感知服务系统</button>
        <span class="topbar-sep">/</span>
        <span class="topbar-center-label">{{ currentCenterLabel }}</span>
        <span class="topbar-sep">/</span>
        <span class="topbar-page">{{ pageLabel }}</span>
      </div>

      <div class="topbar-search">
        <input
          v-model="searchQ"
          type="search"
          placeholder="搜索地点、指标、传感器、任务、方案或数据"
          @keydown.enter="runSearch"
          @focus="searchOpen = searchGroups.length > 0"
        />
        <button type="button" class="btn ghost tiny" :disabled="searchLoading" @click="runSearch">
          {{ searchLoading ? '搜…' : '搜索' }}
        </button>
        <div v-if="searchOpen" class="search-pop">
          <div v-if="!searchGroups.length" class="muted tiny-pad">无匹配结果</div>
          <div v-for="g in searchGroups" :key="g.type" class="search-group">
            <div class="search-type">{{ g.type }}</div>
            <button
              v-for="item in g.items"
              :key="g.type + item.id"
              type="button"
              class="search-item"
              @click="openSearchItem(item)"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ item.subtitle }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="topbar-right">
        <div class="basemap-wrap">
          <button type="button" class="btn ghost tiny" @click="basemapOpen = !basemapOpen">底图</button>
          <div v-if="basemapOpen" class="basemap-menu">
            <button
              v-for="b in basemaps"
              :key="b.key"
              type="button"
              class="basemap-item"
              :class="{ active: shellBasemap === b.key }"
              @click="chooseBasemap(b.key)"
            >
              {{ b.label }}
            </button>
          </div>
        </div>
        <span class="user-chip">{{ user?.username || (loading ? '加载中' : '未登录') }}</span>
        <button v-if="user" type="button" class="btn ghost tiny" @click="doLogout">退出</button>
        <RouterLink v-else to="/login" class="btn ghost tiny">登录</RouterLink>
      </div>
    </header>

    <!-- section -->
    <aside class="left-rail" aria-label="中心导航">
      <button
        v-for="c in centers"
        :key="c.key"
        type="button"
        class="rail-item"
        :class="{ active: activeCenter?.key === c.key }"
        :title="c.label"
        @click="goCenter(c)"
      >
        <span class="rail-icon">{{ c.icon }}</span>
        <span class="rail-text">{{ c.short }}</span>
      </button>
    </aside>

    <!-- section -->
    <aside v-show="leftOpen" class="left-panel" :style="{ width: leftWidth + 'px' }">
      <div class="left-panel-head">
        <div>
          <div class="left-kicker">业务面板</div>
          <strong>{{ currentCenterLabel }}</strong>
        </div>
        <button type="button" class="btn ghost tiny" @click="toggleLeft">收起</button>
      </div>

      <div v-if="subItems.length" class="left-subs">
        <button
          v-for="s in subItems"
          :key="s.key"
          type="button"
          class="left-sub"
          :class="{ active: activeSubKey === s.key }"
          @click="goSub(s.key)"
        >
          {{ s.label }}
        </button>
      </div>

      <div class="left-body">
        <RouterView />
      </div>
      <div class="panel-resizer" title="拖动调整宽度" @mousedown.prevent="onLeftResize" />
    </aside>

    <!-- section -->
    <main class="map-main">
      <MapBasemap />
      <button v-if="!leftOpen" type="button" class="edge-btn left" @click="toggleLeft">展开</button>
      <button v-if="!rightOpen" type="button" class="edge-btn right" @click="toggleRight">详情</button>
    </main>

    <!-- section -->
    <aside class="detail-drawer" :class="{ open: rightOpen }">
      <div class="drawer-head">
        <strong>详情</strong>
        <button type="button" class="btn ghost tiny" @click="closeRight">关闭</button>
      </div>
      <div class="drawer-body">
        <template v-if="shellSelected">
          <div class="drawer-tabs">
            <span class="on">基本信息</span>
            <span>空间信息</span>
            <span>关联关系</span>
            <span>状态</span>
          </div>
          <div class="drawer-meta">{{ kindLabel(shellSelected.kind) }} · ID {{ shellSelected.id }}</div>
          <h3>{{ shellSelected.name }}</h3>
          <pre class="drawer-pre">{{ shellSelected.description || '暂无描述' }}</pre>
          <div class="drawer-actions">
            <button type="button" class="btn" @click="jumpSelectedCenter">跳转业务中心</button>
            <button type="button" class="btn ghost" @click="reflySelected">地图定位</button>
          </div>
        </template>
        <template v-else>
          <p class="muted">点击地图对象或列表记录后在此显示详情与操作</p>
          <p class="hint">
            传感器 {{ shellCounts.sensors }} / 数据 {{ shellCounts.data }} / 任务 {{ shellCounts.tasks }}
          </p>
        </template>
      </div>
    </aside>

    <!-- section -->
    <footer class="bottom-tray" :class="{ open: bottomOpen }">
      <button type="button" class="bottom-toggle" @click="toggleBottom">
        <span>{{ bottomOpen ? '收起托盘' : '展开托盘' }}</span>
        <span class="muted">{{ bottomSummary }}</span>
      </button>
      <div v-if="bottomOpen" class="bottom-body">
        <div class="bottom-grid five">
          <div>
            <h4>总览</h4>
            <p>
              传感器 {{ shellCounts.sensors }} · 数据 {{ shellCounts.data }} · 任务 {{ shellCounts.tasks }} · 指标
              {{ shellCounts.indicators }}
            </p>
          </div>
          <div>
            <h4>当前页面</h4>
            <p>{{ currentCenterLabel }} / {{ pageLabel }}</p>
            <p class="muted">{{ bottomSummary }}</p>
          </div>
          <div>
            <h4>告警</h4>
            <p>
              离线 {{ shellAlerts.offlineSensors }} · 故障/维护 {{ shellAlerts.faultSensors }} · 异常数据
              {{ shellAlerts.anomalousData }} · 失败任务 {{ shellAlerts.failedTasks }}
            </p>
          </div>
          <div>
            <h4>地图操作提示</h4>
            <p v-if="activeCenter?.key === 'planning'">流程：任务建模 → 反算 → 候选评分 → 关联 → 方案；右键任务可进工作台</p>
            <p v-else-if="activeCenter?.key === 'resources'">右键传感器可查看覆盖、最近数据与关联任务</p>
            <p v-else-if="activeCenter?.key === 'indicators'">绘面后点“写入地图绘制范围”同步指标实例空间</p>
            <p v-else-if="activeCenter?.key === 'data'">点选数据气泡查看质量与来源；图层可切换实时/历史</p>
            <p v-else-if="activeCenter?.key === 'algorithms'">列表点击任务后地图高亮输入/结果范围</p>
            <p v-else-if="activeCenter?.key === 'applications'">点击统计卡片联动过滤地图图层</p>
            <p v-else>切换中心保留地图视角；右键地图可快速新建与查询</p>
          </div>

          <div>
            <h4>当前选中 / 工具</h4>
            <p v-if="shellSelected">
              {{ trayKindLabel(shellSelected.kind) }} · {{ shellSelected.name }} · #{{ shellSelected.id }}
            </p>
            <p v-else class="muted">未选中地图对象</p>
            <p v-if="mapToolMessage" class="muted">{{ mapToolMessage }}</p>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
