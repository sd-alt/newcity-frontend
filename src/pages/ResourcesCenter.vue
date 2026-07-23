<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import {
  applyShellSensorStatusFilter,
  reloadShellLayers,
  applyShellSensorTypeFilter,
  setShellVisibility,
  showShellAndFit,
  selectShellFeature,
  shellCounts,
  shellLoading,
  shellSelected,
} from '../gis/mapShell'
import { mapDrawGeometry } from '../gis/mapTools'
import { errMessage, pickId } from '../utils/errors'

const route = useRoute()
const router = useRouter()
const tab = ref('crud')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)

const platformTypes = ref<Record<string, unknown>[]>([])
const sensorTypes = ref<Record<string, unknown>[]>([])
const platforms = ref<Record<string, unknown>[]>([])
const sensors = ref<Record<string, unknown>[]>([])
const viz = ref<unknown>(null)
const vizFilter = ref({ typeCode: '', status: '', keyword: '' })
const qName = ref('')
const qStatus = ref('')
const qType = ref('')
const qOwner = ref('')
const queryHits = ref<Record<string, unknown>[]>([])
const queryPending = ref(false)
const queryPage = ref(1)
const queryPageSize = ref(20)
const queryTotal = ref(0)

const platformForm = ref({ platformTypeId: '', name: '', identifier: '', locationWkt: 'POINT(114.05 22.55)', owner: '演示单位', status: 'active' })
const sensorForm = ref({ platformId: '', sensorName: '', sensorTypeId: '', accuracyPercent: 90, coverageWkt: '' })

const tabs = [
  { key: 'types', label: '传感器类型维护' },
  { key: 'crud', label: '传感器增删改查' },
  { key: 'query', label: '综合查询' },
  { key: 'viz', label: '资源可视化' },
]

const filteredPlatforms = computed(() => {
  // 本地预览：在未点“服务端查询”前仍可用
  const base = queryHits.value.length ? queryHits.value : platforms.value
  return base.filter((p) => {
    const name = String(p.name || '')
    const status = String(p.status || '')
    const typeId = String(p.platformTypeId || p.platformType || '')
    const typeCode = String((p as any).platformTypeCode || (p as any).typeCode || '')
    const owner = String(p.owner || '')
    const okName = qName.value === '' || name.includes(qName.value) || String(p.identifier || '').includes(qName.value)
    const okStatus = qStatus.value === '' || status === qStatus.value
    const okType =
      qType.value === '' ||
      typeId === qType.value ||
      typeCode === qType.value
    const okOwner = qOwner.value === '' || owner.includes(qOwner.value)
    return okName && okStatus && okType && okOwner
  })
})

async function runResourceQuery(resetPage = false) {
  queryPending.value = true
  error.value = null
  if (resetPage) queryPage.value = 1
  try {
    const params = new URLSearchParams()
    if (qName.value) params.set('keyword', qName.value)
    if (qStatus.value) params.set('status', qStatus.value)
    if (qType.value) {
      // 优先 typeId，若用户选的是 code 也兼容 typeCode
      if (/^\d+$/.test(qType.value)) params.set('typeId', qType.value)
      else params.set('typeCode', qType.value)
    }
    if (qOwner.value) params.set('owner', qOwner.value)
    params.set('page', String(queryPage.value))
    params.set('pageSize', String(queryPageSize.value))
    const qs = params.toString()
    const res = await api.listPlatforms(qs ? '?' + qs : '')
    queryHits.value = res.data
    queryTotal.value = Number((res as { total?: number }).total ?? res.data.length)
    queryPage.value = Number((res as { page?: number }).page ?? queryPage.value)
    queryPageSize.value = Number((res as { pageSize?: number }).pageSize ?? queryPageSize.value)
    message.value =
      '服务端综合查询完成：本页 ' +
      res.data.length +
      ' / 共 ' +
      queryTotal.value +
      '（第 ' +
      queryPage.value +
      ' 页）'
  } catch (err) {
    error.value = errMessage(err, '资源查询失败')
  } finally {
    queryPending.value = false
  }
}

async function changeResourcePage(delta: number) {
  const maxPage = Math.max(1, Math.ceil(queryTotal.value / queryPageSize.value) || 1)
  const next = Math.min(maxPage, Math.max(1, queryPage.value + delta))
  if (next === queryPage.value) return
  queryPage.value = next
  await runResourceQuery(false)
}


const vizRows = computed(() => {
  const data = viz.value
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) return (data as any).items
  if (data && typeof data === 'object' && Array.isArray((data as any).platforms)) return (data as any).platforms
  return []
})

function buildVizQuery() {
  const params = new URLSearchParams()
  if (vizFilter.value.typeCode) params.set('typeCode', vizFilter.value.typeCode)
  if (vizFilter.value.status) params.set('status', vizFilter.value.status)
  if (vizFilter.value.keyword) params.set('keyword', vizFilter.value.keyword)
  const s = params.toString()
  return s ? '?' + s : ''
}

async function setTab(key: string) {
  tab.value = key
  await router.replace({ path: '/resources', query: { tab: key } })
}
function syncTab() {
  const q = route.query.tab
  if (typeof q === 'string' && tabs.some((t) => t.key === q)) tab.value = q
}


function applyMapDrawToPlatform() {
  const g = mapDrawGeometry.value
  if (!g || !g.wkt) {
    error.value = '请先用地图工具绘点或绘面（绘点=位置，绘面=覆盖示意）'
    return
  }
  if (g.type === 'point') {
    platformForm.value.locationWkt = g.wkt
    message.value = '已将地图绘点写入平台位置 WKT'
  } else {
    // polygon: use centroid-ish first ring point as location if empty, store full polygon in location if needed
    platformForm.value.locationWkt = g.wkt
    message.value = '已将地图绘面写入平台位置/范围 WKT'
  }
  error.value = null
}

function applyMapDrawToSensor() {
  const g = mapDrawGeometry.value
  if (!g || !g.wkt) {
    error.value = '请先用地图工具绘面（覆盖范围）或绘点'
    return
  }
  if (g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const d = 0.05
    sensorForm.value.coverageWkt = `POLYGON((${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}))`
    message.value = '已将绘点扩展为小范围覆盖写入传感器覆盖 WKT'
  } else {
    sensorForm.value.coverageWkt = g.wkt
    message.value = '已将地图绘面写入传感器覆盖 WKT'
  }
  error.value = null
}

async function load() {
  error.value = null
  try {
    const [pt, st, p, s] = await Promise.all([
      api.listPlatformTypes(),
      api.listSensorTypes(),
      api.listPlatforms(),
      api.listSensors(),
    ])
    platformTypes.value = pt.data
    sensorTypes.value = st.data
    platforms.value = p.data
    sensors.value = s.data
    if (platformForm.value.platformTypeId === '' && platformTypes.value[0]) {
      platformForm.value.platformTypeId = pickId(platformTypes.value[0])
    }
    if (sensorForm.value.sensorTypeId === '' && sensorTypes.value[0]) {
      sensorForm.value.sensorTypeId = pickId(sensorTypes.value[0])
    }
    if (sensorForm.value.platformId === '' && platforms.value[0]) {
      sensorForm.value.platformId = pickId(platforms.value[0])
    }
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
}

async function createPlatform() {
  if (platformForm.value.platformTypeId === '' || platformForm.value.name === '') {
    error.value = '请选择平台类型并填写名称'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.createPlatform({
      platformTypeId: Number(platformForm.value.platformTypeId),
      name: platformForm.value.name,
      identifier: platformForm.value.identifier || undefined,
      locationWkt: platformForm.value.locationWkt || undefined,
      owner: platformForm.value.owner || undefined,
      status: platformForm.value.status || 'active',
    })
    message.value = '平台已创建'
    try { await reloadShellLayers('/resources', {}) } catch { /* map refresh optional */ }
    platformForm.value.name = ''
    platformForm.value.identifier = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

async function setPlatformStatus(id: unknown, status: string) {
  pending.value = true
  error.value = null
  try {
    await api.updatePlatform(String(id), { status })
    message.value = '平台状态已更新为 ' + status
    await load()
  } catch (err) {
    error.value = errMessage(err, '更新平台状态失败')
  } finally {
    pending.value = false
  }
}

async function removePlatform(id: unknown) {
  if (window.confirm('删除平台前将校验关联关系，确认继续？') === false) return
  pending.value = true
  try {
    await api.deletePlatform(String(id))
    message.value = '平台已删除'
    try { await reloadShellLayers('/resources', {}) } catch { /* map refresh optional */ }
    await load()
  } catch (err) {
    error.value = errMessage(err, '删除失败（可能存在关联数据）')
  } finally {
    pending.value = false
  }
}

async function createSensor() {
  if (sensorForm.value.sensorName === '') {
    error.value = '请填写传感器名称'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.createSensor({
      platformId: sensorForm.value.platformId ? Number(sensorForm.value.platformId) : undefined,
      sensorName: sensorForm.value.sensorName,
      sensorTypeId: sensorForm.value.sensorTypeId ? Number(sensorForm.value.sensorTypeId) : undefined,
      accuracyPercent: Number(sensorForm.value.accuracyPercent) || undefined,
      coverageWkt: sensorForm.value.coverageWkt || undefined,
    })
    message.value = '传感器已创建'
    try { await reloadShellLayers('/resources', {}) } catch { /* map refresh optional */ }
    sensorForm.value.sensorName = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

async function removeSensor(id: unknown) {
  if (window.confirm('确认删除传感器？') === false) return
  try {
    await api.deleteSensor(String(id))
    message.value = '传感器已删除'
    try { await reloadShellLayers('/resources', {}) } catch { /* map refresh optional */ }
    await load()
  } catch (err) {
    error.value = errMessage(err, '删除失败')
  }
}

async function loadViz() {
  try {
    const res = await api.getResourceVisualization(buildVizQuery())
    viz.value = res.data
    message.value = '可视化摘要已刷新，共 ' + (Array.isArray(res.data) ? res.data.length : vizRows.value.length) + ' 条'
  } catch (err) {
    error.value = errMessage(err, '可视化数据加载失败')
  }
}

onMounted(async () => {
  syncTab()
  await load()
  if (tab.value === 'viz') await loadViz()
})
watch(() => route.query.tab, syncTab)
watch(tab, async (v) => { if (v === 'viz') await loadViz() })


async function locateOnMap(kind: 'sensor', id: string | number | unknown) {
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  const ok = await selectShellFeature(kind, String(id), { openBubble: true, fly: true })
  message.value = ok
    ? `已在地图定位传感器 #${id}`
    : `地图未找到传感器 #${id} 的空间位置（可能缺少坐标或覆盖范围）`
  if (!ok) error.value = message.value
  else error.value = null
}

async function showOnMap() {
  const typeCode = String(vizFilter.value?.typeCode || '').trim()
  const status = String(vizFilter.value?.status || '').trim()
  await showShellAndFit('sensors', '/resources')
  if (typeCode) await applyShellSensorTypeFilter(typeCode)
  if (status) await applyShellSensorStatusFilter(status)
  const parts: string[] = []
  if (typeCode) parts.push(`类型:${typeCode}`)
  if (status) parts.push(`状态:${status}`)
  message.value = parts.length
    ? `已在地图显示传感资源（${parts.join(' · ')} · ${shellCounts.sensors} 个）`
    : `已在地图显示传感资源（${shellCounts.sensors} 个要素）`
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">传感资源中心</p>
        <h1>传感器类型、资源建模与查询</h1>
      </div>
      <button class="btn" type="button" :disabled="shellLoading" @click="showOnMap">资源上图</button>
    </header>
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <section v-if="tab === 'types'" class="panel">
      <h2>传感器类型维护</h2>
      <p class="muted">管理卫星/无人机/站点等类型的分类编码、属性模板与参数规范，供传感器建模引用。</p>
      <div class="grid-2">
        <div>
          <h3>平台类型（{{ platformTypes.length }}）</h3>
          <table class="table">
            <thead><tr><th>ID</th><th>编码</th><th>名称</th></tr></thead>
            <tbody>
              <tr v-if="!platformTypes.length"><td colspan="3" class="muted">暂无平台类型</td></tr>
              <tr v-for="t in platformTypes" :key="'pt'+t.id"><td>{{ t.id }}</td><td><code>{{ t.code }}</code></td><td>{{ t.name }}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>传感器类型（{{ sensorTypes.length }}）</h3>
          <table class="table">
            <thead><tr><th>ID</th><th>编码</th><th>名称</th></tr></thead>
            <tbody>
              <tr v-if="!sensorTypes.length"><td colspan="3" class="muted">暂无传感器类型</td></tr>
              <tr v-for="t in sensorTypes" :key="'st'+t.id"><td>{{ t.id }}</td><td><code>{{ t.code }}</code></td><td>{{ t.name }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section v-if="tab === 'crud'" class="panel">
      <h2>平台与传感器增删改查</h2>
      <h3>平台</h3>
      <div class="form-row">
        <label>平台类型
          <select v-model="platformForm.platformTypeId">
            <option v-for="t in platformTypes" :key="'pft'+t.id" :value="String(t.id)">{{ t.name }}</option>
          </select>
        </label>
        <label>名称<input v-model="platformForm.name" /></label>
        <label>标识<input v-model="platformForm.identifier" /></label>
        <label>位置WKT<input v-model="platformForm.locationWkt" /></label>
        <button class="btn ghost" type="button" @click="applyMapDrawToPlatform">采用地图绘制→位置</button>
        <label>所属单位<input v-model="platformForm.owner" /></label>
        <label>状态<input v-model="platformForm.status" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createPlatform">新增平台</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>标识</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!platforms.length"><td colspan="6" class="muted">暂无平台/传感器资源，请先新增平台</td></tr>
          <tr v-for="p in platforms" :key="String(p.id)" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'sensor' && shellSelected.id === String(p.id) }" @click="locateOnMap('sensor', String(p.id))">
            <td>{{ p.id }}</td><td>{{ p.name }}</td><td>{{ p.platformTypeId }}</td><td><code>{{ p.identifier }}</code></td><td>{{ p.status }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="setPlatformStatus(p.id, 'active')">启用</button>
              <button class="btn ghost" type="button" @click.stop="setPlatformStatus(p.id, 'inactive')">停用</button>
              <button class="btn ghost" type="button" @click.stop="removePlatform(p.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>传感器</h3>
      <div class="form-row">
        <label>平台
          <select v-model="sensorForm.platformId">
            <option v-for="p in platforms" :key="'sp'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
          </select>
        </label>
        <label>传感器名称<input v-model="sensorForm.sensorName" /></label>
        <label>传感器类型
          <select v-model="sensorForm.sensorTypeId">
            <option v-for="t in sensorTypes" :key="'sft'+t.id" :value="String(t.id)">{{ t.name }}</option>
          </select>
        </label>
        <label>精度%<input v-model.number="sensorForm.accuracyPercent" type="number" /></label>
        <label>覆盖WKT<input v-model="sensorForm.coverageWkt" /></label>
        <button class="btn ghost" type="button" @click="applyMapDrawToSensor">采用地图绘制→覆盖</button>
        <button class="btn" type="button" :disabled="pending" @click="createSensor">新增传感器</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>平台</th><th>类型</th><th>精度</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!sensors.length"><td colspan="6" class="muted">暂无传感器记录</td></tr>
          <tr v-for="s in sensors" :key="'s'+s.id" class="row-click" @click="locateOnMap('sensor', String(s.platformId || s.id))">
            <td>{{ s.id }}</td>
            <td>{{ s.sensorName || s.name || s.id }}</td>
            <td>{{ s.platformId }}</td>
            <td>{{ s.sensorTypeId }}</td>
            <td>{{ s.accuracyPercent ?? '-' }}</td>
            <td><button class="btn ghost" type="button" @click.stop="removeSensor(s.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'query'" class="panel">
      <h2>传感器综合查询</h2>
      <p class="muted">按类型、名称/编码、所属单位、运行状态组合筛选；优先走服务端过滤，结果可被规划中心候选筛选使用。</p>
      <div class="form-row">
        <label>名称/编码关键字<input v-model="qName" placeholder="keyword" /></label>
        <label>状态<input v-model="qStatus" placeholder="active" /></label>
        <label>所属单位<input v-model="qOwner" placeholder="owner" /></label>
        <label>平台类型
          <select v-model="qType">
            <option value="">全部</option>
            <option v-for="t in platformTypes" :key="'qt'+t.id" :value="String(t.id)">{{ t.name }} ({{ t.code }})</option>
          </select>
        </label>
        <label>每页
          <select v-model.number="queryPageSize" @change="runResourceQuery(true)">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="queryPending" @click="runResourceQuery(true)">服务端查询</button>
        <button class="btn ghost" type="button" @click="queryHits = []; queryTotal = 0; queryPage = 1; message = '已清空服务端结果，回到本地列表'">重置</button>
      </div>
      <p class="muted">显示 {{ filteredPlatforms.length }} · 服务端本页 {{ queryHits.length }} / 总计 {{ queryTotal || platforms.length }} · 本地 {{ platforms.length }}</p>
      <div class="form-row" v-if="queryHits.length || queryTotal">
        <button class="btn ghost" type="button" :disabled="queryPending || queryPage <= 1" @click="changeResourcePage(-1)">上一页</button>
        <span class="muted">第 {{ queryPage }} 页</span>
        <button class="btn ghost" type="button" :disabled="queryPending || queryPage * queryPageSize >= queryTotal" @click="changeResourcePage(1)">下一页</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>标识</th><th>所属单位</th><th>位置</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-if="!filteredPlatforms.length"><td colspan="6" class="muted">无匹配查询结果</td></tr>
          <tr v-for="p in filteredPlatforms" :key="'f'+p.id" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'sensor' && shellSelected.id === String(p.id) }" @click="locateOnMap('sensor', String(p.id))">
            <td>{{ p.id }}</td>
            <td>{{ p.name }}</td>
            <td>{{ p.platformTypeName || p.platformTypeId || p.platformType || '-' }}</td>
            <td>{{ p.identifier }}</td>
            <td>{{ p.owner || '-' }}</td>
            <td><code>{{ p.locationWkt || '-' }}</code></td>
            <td>{{ p.status }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'viz'" class="panel">
      <h2>资源可视化</h2>
      <p class="muted">先按类型/状态摘要核对资源空间与能力信息，再进入 GIS 工作台做地图叠加。</p>
      <div class="form-row">
        <label>类型编码<input v-model="vizFilter.typeCode" placeholder="station" /></label>
        <label>状态<input v-model="vizFilter.status" placeholder="active" /></label>
        <label>关键字<input v-model="vizFilter.keyword" /></label>
        <button class="btn" type="button" @click="loadViz">刷新摘要</button>
        <button class="btn" type="button" :disabled="shellLoading" @click="showOnMap">底图上图</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="showOnMap">图层刷新上图</button>
      </div>
      <p class="muted">摘要条数 {{ vizRows.length }}</p>
      <table class="table" v-if="vizRows.length">
        <thead>
          <tr>
            <th>ID</th><th>名称</th><th>类型</th><th>状态</th><th>单位</th><th>位置</th><th>能力摘要</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!vizRows.length"><td colspan="6" class="muted">暂无可视化资源，请先上图或调整筛选</td></tr>
          <tr v-for="row in vizRows" :key="String(row.platformId || row.id)" class="row-click" @click="locateOnMap('sensor', String(row.platformId || row.id))">
            <td>{{ row.platformId || row.id }}</td>
            <td>{{ row.platformName || row.name }}</td>
            <td>{{ row.typeName || row.typeCode }}</td>
            <td>{{ row.status || '-' }}</td>
            <td>{{ row.owner || '-' }}</td>
            <td class="clamp">{{ row.locationWkt || (row.spatial as any)?.positionWkt || '-' }}</td>
            <td class="clamp">{{ JSON.stringify(row.capabilitySummary || row.typeSummary || {}).slice(0, 80) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无可视化摘要，点击刷新或调整筛选。</p>
    </section>
  </section>
</template>
