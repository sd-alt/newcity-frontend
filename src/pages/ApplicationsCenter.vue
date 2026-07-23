<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import {
  reloadShellLayers,
  patchShellFilters,
  selectShellFeature,
  shellCounts,
  shellFilters,
  shellLoading,
  shellStatus,
  shellSelected,
} from '../gis/mapShell'
import { errMessage } from '../utils/errors'
import { useAuthStore } from '../stores/auth'

const { user } = useAuthStore()
const route = useRoute()
const router = useRouter()
const tab = ref('gis')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)
const mapFocus = ref<{ kind: string; id: string; name: string } | null>(null)
const activeMapFilter = ref<'sensors' | 'data' | 'tasks' | 'all' | 'indicators'>('all')

const resourceStats = ref<Record<string, unknown> | null>(null)
const dataStats = ref<Record<string, unknown> | null>(null)
const taskStats = ref<Record<string, unknown> | null>(null)
const workbench = ref<Record<string, unknown> | null>(null)
const layers = ref<Record<string, unknown>[]>([])
const gisPreview = ref<Record<string, unknown> | null>(null)
const previewIds = computed(() => {
  const g = gisPreview.value as Record<string, { firstId?: string }> | null
  return {
    sensor: String(g?.sensors?.firstId || ''),
    data: String(g?.data?.firstId || ''),
    task: String(g?.tasks?.firstId || ''),
  }
})

const resourceFilter = ref({ typeCode: '', status: '', owner: '', keyword: '' })
const dataFilter = ref({ dataType: '', qualityStatus: '', accessLevel: '', isQuarantined: '' })
const taskFilter = ref({ status: '', taskType: '', keyword: '' })

const tabs = [
  { key: 'stats', label: '综合统计' },
  { key: 'gis', label: 'GIS综合展示' },
  { key: 'workbench', label: '工作台与图层' },
]

type CountRow = Record<string, unknown>


function statBarPct(count: unknown, max: number) {
  const n = Number(count || 0)
  if (!Number.isFinite(n) || n <= 0 || !max) return 0
  return Math.max(6, Math.round((n / max) * 100))
}

function maxCount(rows: Array<Record<string, unknown>>) {
  let m = 0
  for (const r of rows) {
    const n = Number(r.count ?? r.total ?? r.value ?? 0)
    if (Number.isFinite(n) && n > m) m = n
  }
  return m || 1
}

function asRows(value: unknown): CountRow[] {
  return Array.isArray(value) ? (value as CountRow[]) : []
}

function rowLabel(row: CountRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]) !== '') return String(row[key])
  }
  return '-'
}

function rowCount(row: CountRow) {
  const v = row.count ?? row.total ?? row.value
  return v == null ? '-' : v
}

const resourceByType = computed(() => asRows(resourceStats.value?.byType))
const resourceByStatus = computed(() => asRows(resourceStats.value?.byStatus))
const resourceByOwner = computed(() => asRows(resourceStats.value?.byOwner))
const dataByType = computed(() => asRows(dataStats.value?.byDataType))
const dataByQuality = computed(() => asRows(dataStats.value?.byQualityStatus))
const taskByStatus = computed(() => asRows(taskStats.value?.byStatus))
const taskByType = computed(() => asRows(taskStats.value?.byTaskType))
const taskByScene = computed(() => asRows(taskStats.value?.byScene))

async function setTab(key: string) {
  tab.value = key
  await router.replace({ path: '/applications', query: { tab: key } })
}
function syncTab() {
  const t = route.query.tab
  if (typeof t === 'string') {
    if (t === 'sensors' || t === 'data' || t === 'tasks') tab.value = 'gis'
    else if (tabs.some((x) => x.key === t)) tab.value = t
  }
}

function buildQuery(params: Record<string, string>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v)
  }
  const s = q.toString()
  return s ? '?' + s : ''
}

async function loadStats(options: { quiet?: boolean } = {}) {
  if (user.value == null) return
  pending.value = true
  error.value = null
  try {
    const [r, d, t] = await Promise.all([
      api.resourceStatistics(
        buildQuery({
          typeCode: resourceFilter.value.typeCode,
          status: resourceFilter.value.status,
          owner: resourceFilter.value.owner,
          keyword: resourceFilter.value.keyword,
        }),
      ),
      api.dataStatistics(
        buildQuery({
          dataType: dataFilter.value.dataType,
          qualityStatus: dataFilter.value.qualityStatus,
          accessLevel: dataFilter.value.accessLevel,
          isQuarantined: dataFilter.value.isQuarantined,
        }),
      ),
      api.taskStatistics(
        buildQuery({
          status: taskFilter.value.status,
          taskType: taskFilter.value.taskType,
          keyword: taskFilter.value.keyword,
        }),
      ),
    ])
    resourceStats.value = r.data as Record<string, unknown>
    dataStats.value = d.data as Record<string, unknown>
    taskStats.value = t.data as Record<string, unknown>
    if (!options.quiet) message.value = '统计已刷新'
  } catch (err) {
    error.value = errMessage(err, '统计加载失败')
  } finally {
    pending.value = false
  }
}

async function loadWorkbench() {
  try {
    const [w, l] = await Promise.all([api.getGisWorkbench(), api.listGisLayers()])
    workbench.value = w.data as Record<string, unknown>
    layers.value = l.data
  } catch (err) {
    error.value = errMessage(err, '工作台加载失败')
  }
}

async function loadGisPreview() {
  try {
    const [s, d, t] = await Promise.all([api.getSensorGis(), api.getDataGis(), api.getTaskGis()])
    const sFeats = ((s.data as { features?: Array<Record<string, unknown>> }).features || [])
    const dFeats = ((d.data as { features?: Array<Record<string, unknown>> }).features || [])
    const tFeats = ((t.data as { features?: Array<Record<string, unknown>> }).features || [])
    gisPreview.value = {
      sensors: {
        total: (s.data as { total?: number }).total,
        features: sFeats.length,
        firstId: sFeats[0] ? String(sFeats[0].platformId ?? sFeats[0].id ?? '') : '',
      },
      data: {
        total: (d.data as { total?: number }).total,
        features: dFeats.length,
        firstId: dFeats[0] ? String(dFeats[0].id ?? '') : '',
      },
      tasks: {
        total: (t.data as { total?: number }).total,
        features: tFeats.length,
        firstId: tFeats[0] ? String(tFeats[0].id ?? '') : '',
      },
    }
  } catch (err) {
    error.value = errMessage(err, 'GIS 预览加载失败')
  }
}

async function locatePreview(kind: 'sensor' | 'data' | 'task') {
  const prev = gisPreview.value as Record<string, { firstId?: string; features?: number }> | null
  const bucket = prev?.[kind === 'sensor' ? 'sensors' : kind === 'data' ? 'data' : 'tasks']
  const id = String(bucket?.firstId || '').trim()
  if (!id) {
    message.value = '当前没有可定位的' + (kind === 'sensor' ? '传感器' : kind === 'data' ? '数据' : '任务')
    return
  }
  const ok = await selectShellFeature(kind, id, { openBubble: true, fly: true })
  if (ok) {
    mapFocus.value = {
      kind,
      id,
      name: (kind === 'sensor' ? '传感器' : kind === 'data' ? '数据' : '任务') + ' #' + id,
    }
    message.value = '已在地图定位' + mapFocus.value.name
  } else {
    message.value = '定位失败：未找到对应空间要素'
  }
}

function kindLabel(kind: unknown) {
  const k = String(kind || '')
  if (k === "sensor") return "传感资源"
  if (k === "data") return "监测数据"
  if (k === "task") return "观测任务"
  if (k === "indicator") return "指标实例"
  return k || "对象"
}

watch(shellSelected, async (v) => {
  if (!v) {
    return
  }
  if (!String(route.path || "").includes("/applications")) return
  mapFocus.value = {
    kind: String(v.kind || ""),
    id: String(v.id || ""),
    name: String(v.name || ""),
  }
  error.value = null
  // 地图点选反向联动：切换对应业务图层（不强制 fly，避免打断用户视角）
  try {
    if (v.kind === "sensor") {
      activeMapFilter.value = "sensors"
      await patchShellFilters(
        { showSensors: true, showData: false, showTasks: false, showIndicators: false },
        { fit: false, rerender: false },
      )
    } else if (v.kind === "data") {
      activeMapFilter.value = "data"
      await patchShellFilters(
        { showSensors: false, showData: true, showTasks: false, showIndicators: false },
        { fit: false, rerender: false },
      )
    } else if (v.kind === "task") {
      activeMapFilter.value = "tasks"
      await patchShellFilters(
        { showSensors: false, showData: false, showTasks: true, showIndicators: false },
        { fit: false, rerender: false },
      )
    } else if (v.kind === "indicator") {
      activeMapFilter.value = "indicators"
      await patchShellFilters(
        { showSensors: false, showData: false, showTasks: false, showIndicators: true },
        { fit: false, rerender: false },
      )
    }
  } catch {
    /* map filter optional */
  }
  message.value =
    "地图选中：" +
    kindLabel(v.kind) +
    " " +
    String(v.name || "") +
    "（#" +
    String(v.id) +
    "）— 已反向联动图层/统计，业务 ID 与列表一致"
})

async function clearMapFocus() {
  mapFocus.value = null
  activeMapFilter.value = 'all'
  await mapShowAll()
  message.value = '已清除地图联动并恢复全部图层'
}

async function jumpFromMapFocus() {
  const f = mapFocus.value
  if (!f) return
  if (f.kind === "sensor") await router.push({ path: "/resources", query: { tab: "crud" } })
  else if (f.kind === "data") await router.push({ path: "/data", query: { tab: "query" } })
  else if (f.kind === "task") await router.push({ path: "/planning", query: { tab: "tasks" } })
  else if (f.kind === "indicator") await router.push({ path: "/indicators", query: { tab: "instances" } })
}

onMounted(async () => {
  syncTab()
  await loadStats({ quiet: true })
  if (tab.value === 'workbench') await loadWorkbench()
  if (tab.value === 'gis') await loadGisPreview()
})
watch(() => route.query.tab, syncTab)
watch(tab, async (v) => {
  if (v === 'workbench') await loadWorkbench()
  if (v === 'gis') await loadGisPreview()
})
watch(user, () => {
  void loadStats({ quiet: true })
})

async function mapShowSensors() {
  await patchShellFilters(
    {
      showSensors: true,
      showData: false,
      showTasks: false,
      showIndicators: false,
      sensorType: '',
      sensorStatus: '',
      dataQuality: '',
      taskStatus: '',
      taskId: '',
    },
    { fit: true, rerender: true },
  )
  message.value = `统计联动：仅显示传感资源（${shellCounts.sensors}）`
}

async function mapShowData() {
  await patchShellFilters(
    {
      showSensors: false,
      showData: true,
      showTasks: false,
      showIndicators: false,
      sensorType: '',
      sensorStatus: '',
      dataQuality: '',
      taskStatus: '',
      taskId: '',
    },
    { fit: true, rerender: true },
  )
  message.value = `统计联动：仅显示监测数据（${shellCounts.data}）`
}

async function mapShowTasks() {
  await patchShellFilters(
    {
      showSensors: false,
      showData: false,
      showTasks: true,
      showIndicators: false,
      sensorType: '',
      sensorStatus: '',
      dataQuality: '',
      taskStatus: '',
      taskId: '',
    },
    { fit: true, rerender: true },
  )
  message.value = `统计联动：仅显示观测任务（${shellCounts.tasks}）`
}

async function mapShowAll() {
  await patchShellFilters(
    {
      showSensors: true,
      showData: true,
      showTasks: true,
      showIndicators: true,
      sensorType: '',
      sensorStatus: '',
      dataQuality: '',
      taskStatus: '',
      taskId: '',
    },
    { fit: true, rerender: true },
  )
  message.value = '统计联动：显示全部业务图层'
}

async function mapShowIndicators() {
  await reloadShellLayers('/applications', {})
  await patchShellFilters(
    { showSensors: false, showData: false, showTasks: false, showIndicators: true },
    { fit: true, rerender: false },
  )
  message.value = `已切换：主显指标实例范围（${shellCounts.indicators} 个）`
}

async function mapRefresh() {
  await reloadShellLayers(route.path, route.query as Record<string, unknown>)
  message.value = '图层已刷新'
}

async function toggleShellLayer(key: 'showSensors' | 'showData' | 'showTasks' | 'showIndicators', ev: Event) {
  const checked = (ev.target as HTMLInputElement).checked
  // 勾选空图层时补载一次，避免只有开关没有要素
  if (checked) {
    const empty =
      (key === 'showSensors' && shellCounts.sensors === 0) ||
      (key === 'showData' && shellCounts.data === 0) ||
      (key === 'showTasks' && shellCounts.tasks === 0) ||
      (key === 'showIndicators' && shellCounts.indicators === 0)
    if (empty) {
      await reloadShellLayers(route.path, route.query as Record<string, unknown>)
    }
  }
  await patchShellFilters({ [key]: checked }, { rerender: false })
  message.value =
    (checked ? '已显示' : '已隐藏') +
    ({ showSensors: '传感资源', showData: '监测数据', showTasks: '观测任务', showIndicators: '指标实例' }[key] || '图层')
}

async function filterMapByStat(kind: 'sensors' | 'data' | 'tasks' | 'all' | 'indicators') {
  error.value = null
  activeMapFilter.value = kind
  if (kind === 'all') await mapShowAll()
  else if (kind === 'sensors') await mapShowSensors()
  else if (kind === 'data') await mapShowData()
  else if (kind === 'tasks') await mapShowTasks()
  else await mapShowIndicators()
  const labels: Record<string, string> = {
    sensors: '传感资源',
    data: '监测数据',
    tasks: '观测任务',
    indicators: '指标实例',
    all: '全部业务图层',
  }
  message.value = '统计联动：仅显示' + (labels[kind] || kind) + '（地图图层已更新）'
}

async function filterSensorsByType(typeCode: unknown) {
  const code = String(typeCode || '').trim()
  resourceFilter.value.typeCode = code
  await patchShellFilters(
    {
      showSensors: true,
      showData: false,
      showTasks: false,
      sensorType: code,
      sensorStatus: '',
    },
    { fit: true, rerender: true },
  )
  message.value = code
    ? `地图已按传感器类型过滤：${code}（${shellCounts.sensors}）`
    : '已清除类型过滤'
}

async function filterSensorsByStatus(status: unknown) {
  const st = String(status || '').trim()
  resourceFilter.value.status = st
  await patchShellFilters(
    {
      showSensors: true,
      showData: false,
      showTasks: false,
      sensorStatus: st,
      sensorType: resourceFilter.value.typeCode,
    },
    { fit: true, rerender: true },
  )
  message.value = st
    ? `地图已按传感器状态过滤：${st}（${shellCounts.sensors}）`
    : '已清除状态过滤'
}

async function filterDataByQuality(quality: unknown) {
  const q = String(quality || '').trim()
  dataFilter.value.qualityStatus = q
  await patchShellFilters(
    {
      showSensors: false,
      showData: true,
      showTasks: false,
      dataQuality: q,
    },
    { fit: true, rerender: true },
  )
  message.value = q
    ? `地图已按数据质量过滤：${q}（${shellCounts.data}）`
    : '已清除质量过滤'
}

async function filterTasksByStatus(status: unknown) {
  const st = String(status || '').trim()
  taskFilter.value.status = st
  await patchShellFilters(
    {
      showSensors: false,
      showData: false,
      showTasks: true,
      taskStatus: st,
    },
    { fit: true, rerender: true },
  )
  message.value = st
    ? `地图已按任务状态过滤：${st}（${shellCounts.tasks}）`
    : '已清除任务状态过滤'
}

</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">综合应用中心</p>
        <h1>综合统计与 GIS 展示</h1>
        <p class="muted">统计与地图联动：点击下方按钮切换地图图层；也可在地图右侧「图层」工具中勾选。</p>
      </div>
      <div class="plan-head-actions" style="display:flex;gap:0.35rem;flex-wrap:wrap">
        <button class="btn" type="button" :disabled="pending" @click="mapShowAll">底图全部上图</button>
        <button class="btn ghost" type="button" :disabled="pending" data-map-action="restore-all" @click="clearMapFocus">恢复全部图层</button>
      </div>
    </header>
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="setTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    
      <div v-if="mapFocus" class="map-focus-banner">
        <div>
          <strong>地图联动对象</strong>
          {{ kindLabel(mapFocus.kind) }} · {{ mapFocus.name || '未命名' }} · #{{ mapFocus.id }}
        </div>
        <div class="ops">
          <button class="btn ghost tiny" type="button" @click="jumpFromMapFocus">打开所属中心</button>
          <button class="btn ghost tiny" type="button" @click="clearMapFocus">清除联动</button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <section v-if="tab === 'stats'" class="panel">

        <div class="map-link-bar">
          <span class="muted">地图联动：</span>
          <button type="button" class="btn ghost tiny" :class="{ active: activeMapFilter === 'sensors' }" data-map-filter="sensors" @click="filterMapByStat('sensors')">仅传感资源</button>
          <button type="button" class="btn ghost tiny" :class="{ active: activeMapFilter === 'data' }" data-map-filter="data" @click="filterMapByStat('data')">仅监测数据</button>
          <button type="button" class="btn ghost tiny" :class="{ active: activeMapFilter === 'tasks' }" data-map-filter="tasks" @click="filterMapByStat('tasks')">仅观测任务</button>
          <button type="button" class="btn ghost tiny" :class="{ active: activeMapFilter === 'indicators' }" data-map-filter="indicators" @click="filterMapByStat('indicators')">仅指标实例</button>
          <button type="button" class="btn ghost tiny" :class="{ active: activeMapFilter === 'all' }" data-map-filter="all" @click="filterMapByStat('all')">显示全部</button>
          <span class="muted tiny">当前：{{ activeMapFilter }}</span>
        </div>

      <p class="muted">对应任务清单 C4–C6：传感资源统计、监测数据统计、观测任务统计。支持条件筛选与下钻到明细中心。</p>
      <h2>综合统计（文档 3 项）</h2>
      <p class="muted">传感资源 / 监测数据 / 观测任务。先设筛选条件，再刷新；结果按维度分表展示，避免只看原始 JSON。</p>
      <button class="btn" type="button" :disabled="pending" @click="() => loadStats()">刷新统计</button>

      <h3>C4 传感资源统计</h3>
      <div class="form-row">
        <label>类型编码<input v-model="resourceFilter.typeCode" placeholder="station/satellite" /></label>
        <label>状态<input v-model="resourceFilter.status" placeholder="active" /></label>
        <label>所属单位<input v-model="resourceFilter.owner" /></label>
        <label>关键字<input v-model="resourceFilter.keyword" /></label>
        <button class="btn ghost" type="button" :disabled="pending" @click="() => loadStats()">按条件统计</button>
        <RouterLink class="btn ghost" to="/resources?tab=query">下钻查询</RouterLink>
      </div>
      <div class="cards">
        <button type="button" class="card stat clickable" @click="filterMapByStat('sensors')"><h3>资源总数</h3><p class="stat-num">{{ resourceStats?.total ?? '—' }}</p><span class="muted">点击仅显传感资源</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('sensors')"><h3>类型数</h3><p class="stat-num">{{ resourceByType.length }}</p><span class="muted">联动地图图层</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('sensors')"><h3>状态类</h3><p class="stat-num">{{ resourceByStatus.length }}</p><span class="muted">联动地图图层</span></button>
      </div>
      <div class="grid-2">
        <div>
          <h4>按类型</h4>
          <table class="table">
            <thead><tr><th>类型</th><th>编码</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!resourceByType.length"><td colspan="3" class="muted">暂无类型统计，点击刷新统计或检查数据</td></tr>
              <tr v-for="(row, i) in resourceByType" :key="'rt'+i" class="row-click" @click="filterSensorsByType(row.typeCode || row.code)">
                <td>{{ rowLabel(row, ['typeName', 'name', 'label']) }}</td>
                <td>{{ rowLabel(row, ['typeCode', 'code']) }}</td>
                <td>
                  <div class="stat-bar-row">
                    <span>{{ rowCount(row) }}</span>
                    <i class="stat-bar" :style="{ width: statBarPct(rowCount(row), maxCount(resourceByType)) + '%' }"></i>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>按状态</h4>
          <table class="table">
            <thead><tr><th>状态</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!resourceByStatus.length"><td colspan="3" class="muted">暂无状态统计</td></tr>
              <tr v-for="(row, i) in resourceByStatus" :key="'rs'+i" class="row-click" @click="filterSensorsByStatus(row.status || row.label || row.name)">
                <td>{{ rowLabel(row, ['status', 'label', 'name']) }}</td>
                <td>{{ rowCount(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <h4>按所属单位（Top）</h4>
      <table class="table">
        <thead><tr><th>单位</th><th>数量</th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in resourceByOwner.slice(0, 12)" :key="'ro'+i">
            <td>{{ rowLabel(row, ['owner', 'label', 'name']) }}</td>
            <td>{{ rowCount(row) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>C5 监测数据统计</h3>
      <div class="form-row">
        <label>数据类型<input v-model="dataFilter.dataType" placeholder="timeseries" /></label>
        <label>质量状态<input v-model="dataFilter.qualityStatus" placeholder="passed/failed" /></label>
        <label>访问级别<input v-model="dataFilter.accessLevel" placeholder="public" /></label>
        <label>隔离
          <select v-model="dataFilter.isQuarantined">
            <option value="">全部</option>
            <option value="true">仅隔离</option>
            <option value="false">非隔离</option>
          </select>
        </label>
        <button class="btn ghost" type="button" :disabled="pending" @click="() => loadStats()">按条件统计</button>
        <RouterLink class="btn ghost" to="/data?tab=query">下钻查询</RouterLink>
      </div>
      <div class="cards">
        <button type="button" class="card stat clickable" @click="filterMapByStat('data')"><h3>数据总数</h3><p class="stat-num">{{ dataStats?.total ?? '—' }}</p><span class="muted">点击仅显监测数据</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('data')"><h3>隔离数</h3><p class="stat-num">{{ dataStats?.quarantinedCount ?? '—' }}</p><span class="muted">联动数据图层</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('data')"><h3>质量类</h3><p class="stat-num">{{ dataByQuality.length }}</p><span class="muted">可点质量行过滤</span></button>
      </div>
      <div class="grid-2">
        <div>
          <h4>按数据类型</h4>
          <table class="table">
            <thead><tr><th>类型</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in dataByType" :key="'dt'+i">
                <td>{{ rowLabel(row, ['dataType', 'label', 'name']) }}</td>
                <td>{{ rowCount(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>按质量状态</h4>
          <table class="table">
            <thead><tr><th>质量</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!dataByQuality.length"><td colspan="3" class="muted">暂无质量统计</td></tr>
              <tr v-for="(row, i) in dataByQuality" :key="'dq'+i" class="row-click" @click="filterDataByQuality(row.qualityStatus || row.label || row.name)">
                <td>{{ rowLabel(row, ['qualityStatus', 'label', 'name']) }}</td>
                <td>
                  <div class="stat-bar-row">
                    <span>{{ rowCount(row) }}</span>
                    <i class="stat-bar" :style="{ width: statBarPct(rowCount(row), maxCount(dataByQuality)) + '%' }"></i>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h3>C6 观测任务统计</h3>
      <div class="form-row">
        <label>状态<input v-model="taskFilter.status" placeholder="submitted" /></label>
        <label>任务类型<input v-model="taskFilter.taskType" /></label>
        <label>关键字<input v-model="taskFilter.keyword" /></label>
        <button class="btn ghost" type="button" :disabled="pending" @click="() => loadStats()">按条件统计</button>
        <RouterLink class="btn ghost" to="/planning?tab=tasks">任务列表</RouterLink>
        <RouterLink class="btn ghost" to="/planning?tab=plans">方案管理</RouterLink>
      </div>
      <div class="form-row" style="margin-bottom:0.5rem">
        <RouterLink class="btn ghost" to="/planning?tab=tasks">下钻任务管理</RouterLink>
      </div>
      <div class="cards">
        <button type="button" class="card stat clickable" @click="filterMapByStat('tasks')"><h3>任务总数</h3><p class="stat-num">{{ taskStats?.total ?? '—' }}</p><span class="muted">点击仅显观测任务</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('tasks')"><h3>已有方案</h3><p class="stat-num">{{ taskStats?.withPlanCount ?? '—' }}</p><span class="muted">联动任务图层</span></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('tasks')"><h3>状态类</h3><p class="stat-num">{{ taskByStatus.length }}</p><span class="muted">可点状态行过滤</span></button>
      </div>
      <div class="grid-2">
        <div>
          <h4>按状态</h4>
          <table class="table">
            <thead><tr><th>状态</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!taskByStatus.length"><td colspan="3" class="muted">暂无任务状态统计</td></tr>
              <tr v-for="(row, i) in taskByStatus" :key="'ts'+i" class="row-click" @click="filterTasksByStatus(row.status || row.label || row.name)">
                <td>{{ rowLabel(row, ['status', 'label', 'name']) }}</td>
                <td>
                  <div class="stat-bar-row">
                    <span>{{ rowCount(row) }}</span>
                    <i class="stat-bar" :style="{ width: statBarPct(rowCount(row), maxCount(taskByStatus)) + '%' }"></i>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>按任务类型</h4>
          <table class="table">
            <thead><tr><th>类型</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in taskByType" :key="'tt'+i">
                <td>{{ rowLabel(row, ['taskType', 'label', 'name']) }}</td>
                <td>{{ rowCount(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <h4>按场景</h4>
      <table class="table">
        <thead><tr><th>场景</th><th>编码</th><th>数量</th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in taskByScene" :key="'tsc'+i">
            <td>{{ rowLabel(row, ['sceneName', 'name', 'label']) }}</td>
            <td>{{ rowLabel(row, ['sceneCode', 'code']) }}</td>
            <td>{{ rowCount(row) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'gis'" class="panel">
      <h2>GIS 综合展示</h2>
      <p class="muted">直接控制全屏底图上的业务图层（不再嵌套第二张地图）。{{ shellStatus }}</p>
      <div class="form-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.4rem">
        <button class="btn ghost" type="button" :disabled="!previewIds.sensor" @click="locatePreview('sensor')">定位首个传感器</button>
        <button class="btn ghost" type="button" :disabled="!previewIds.data" @click="locatePreview('data')">定位首条数据</button>
        <button class="btn ghost" type="button" :disabled="!previewIds.task" @click="locatePreview('task')">定位首个任务</button>
      </div>
      <div class="form-row">
        <button class="btn" type="button" :disabled="shellLoading" @click="filterMapByStat('sensors')">仅显示传感器</button>
        <button class="btn" type="button" :disabled="shellLoading" @click="filterMapByStat('data')">仅显示监测数据</button>
        <button class="btn" type="button" :disabled="shellLoading" @click="filterMapByStat('tasks')">仅显示观测任务</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="filterMapByStat('all')">显示全部图层</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="mapShowIndicators">仅指标范围</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="mapRefresh">刷新图层</button>
      </div>
      <div class="form-row" style="margin-top:0.6rem">
        <label class="check"><input type="checkbox" :checked="shellFilters.showSensors" @change="toggleShellLayer('showSensors', $event)" /> 传感器 <span class="badge">{{ shellCounts.sensors }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showData" @change="toggleShellLayer('showData', $event)" /> 监测数据 <span class="badge">{{ shellCounts.data }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showTasks" @change="toggleShellLayer('showTasks', $event)" /> 观测任务 <span class="badge">{{ shellCounts.tasks }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showIndicators" @change="toggleShellLayer('showIndicators', $event)" /> 指标实例 <span class="badge">{{ shellCounts.indicators }}</span></label>
      </div>
      <div class="cards" style="margin-top:0.8rem">
        <button type="button" class="card stat clickable" @click="filterMapByStat('sensors')"><h3>传感器要素</h3><p class="stat-num">{{ shellCounts.sensors }}</p></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('data')"><h3>数据要素</h3><p class="stat-num">{{ shellCounts.data }}</p></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('tasks')"><h3>任务要素</h3><p class="stat-num">{{ shellCounts.tasks }}</p></button>
        <button type="button" class="card stat clickable" @click="filterMapByStat('indicators')"><h3>指标实例</h3><p class="stat-num">{{ shellCounts.indicators }}</p></button>
      </div>
      <div class="layer-tree">
        <h3>业务图层树</h3>
        <label class="check"><input type="checkbox" :checked="shellFilters.showSensors" @change="toggleShellLayer('showSensors', $event)" /> 传感资源 <span class="badge">{{ shellCounts.sensors }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showData" @change="toggleShellLayer('showData', $event)" /> 监测数据 <span class="badge">{{ shellCounts.data }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showTasks" @change="toggleShellLayer('showTasks', $event)" /> 观测任务 <span class="badge">{{ shellCounts.tasks }}</span></label>
        <label class="check"><input type="checkbox" :checked="shellFilters.showIndicators" @change="toggleShellLayer('showIndicators', $event)" /> 指标实例 <span class="badge">{{ shellCounts.indicators }}</span></label>
        <div class="form-row" style="margin-top:0.45rem">
          <button class="btn ghost tiny" type="button" @click="mapShowIndicators">仅指标范围</button>
          <button class="btn ghost tiny" type="button" @click="mapShowAll">全部显示</button>
          <button class="btn ghost tiny" type="button" @click="mapRefresh">刷新</button>
        </div>
      </div>
      <p class="hint">点击统计卡片/表格行会过滤地图图层；点击底图要素打开气泡与右侧详情。</p>
    </section>

<section v-if="tab === 'workbench'" class="panel">
      <h2>工作台与图层</h2>
      <p class="muted">工作台启动数据与 GIS 图层清单，用于核对可展示资源是否齐全。</p>
      <button class="btn ghost" type="button" @click="loadWorkbench">刷新</button>
      <h3>图层目录（{{ layers.length }}）</h3>
      <table class="table" v-if="layers.length">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>状态</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="layer in layers" :key="String(layer.id)">
            <td>{{ layer.id }}</td>
            <td>{{ layer.name || layer.title || '-' }}</td>
            <td>{{ layer.layerType || layer.type || '-' }}</td>
            <td>{{ layer.status || '-' }}</td>
            <td class="clamp">{{ layer.description || layer.url || '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无图层目录记录。</p>
      <h3>工作台原始摘要</h3>
      <pre class="result-pre">{{ workbench ? JSON.stringify(workbench, null, 2).slice(0, 3500) : '暂无' }}</pre>
      <button class="btn" type="button" :disabled="pending" @click="mapShowAll">底图全部上图</button>
    </section>
  </section>
</template>
