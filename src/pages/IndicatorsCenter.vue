<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import {
  selectShellFeature,
  shellCounts,
  shellLoading,
  shellSelected,
  shellStatus,
  showIndicatorsWorkspace,
} from '../gis/mapShell'
import { errMessage, isoNow, pickId } from '../utils/errors'
import { mapDrawGeometry } from '../gis/mapTools'

const route = useRoute()
const router = useRouter()
const tab = ref('instances')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)
const sampleFilterDomain = ref('')
const sampleFilterTheme = ref('')
const sampleKeyword = ref('')

const domains = ref<Record<string, unknown>[]>([])
const themes = ref<Record<string, unknown>[]>([])
const scales = ref<Record<string, unknown>[]>([])
const definitions = ref<Record<string, unknown>[]>([])
const instances = ref<Record<string, unknown>[]>([])
const tree = ref<Array<Record<string, unknown>>>([])
const selectedTreeDefId = ref('')
const expandedDomains = ref<Record<string, boolean>>({})
const expandedThemes = ref<Record<string, boolean>>({})
const expandedDefs = ref<Record<string, boolean>>({})
const versions = ref<Record<string, unknown>[]>([])
const exportPreview = ref('')
const queryText = ref('')
const queryStatus = ref('')
const queryDefId = ref('')
const queryScaleId = ref('')
const queryHits = ref<Record<string, unknown>[]>([])
const queryPending = ref(false)

const defForm = ref({ code: '', name: '', displayName: '', domainId: '', themeId: '', unit: '', defaultAccuracy: 90 })
const instForm = ref({
  defId: '',
  instanceName: '',
  scaleId: '',
  spatialWkt: 'POLYGON((114 22,115 22,115 23,114 23,114 22))',
  resolution: 10,
  temporalRes: '小时/次',
  targetAccuracy: 90,
})

function applyMapDrawWkt() {
  const g = mapDrawGeometry.value
  if (!g || !g.wkt) {
    error.value = '请先用地图工具绘制点或面（绘点/绘面）'
    return
  }
  if (g.type === 'point') {
    // expand point to small polygon for instance spatial range
    const lon = g.lon ?? 0
    const lat = g.lat ?? 0
    const d = 0.05
    instForm.value.spatialWkt = `POLYGON((${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}))`
  } else {
    instForm.value.spatialWkt = g.wkt
  }
  message.value = '已将地图绘制范围写入指标实例'
  error.value = null
}

const versionDefId = ref('')
const versionInstanceId = ref('')
const instanceVersions = ref<Record<string, unknown>[]>([])
const compareFrom = ref('')
const compareTo = ref('')
const compareResult = ref<unknown>(null)

const tabs = [
  { key: 'samples', label: '指标样例维护' },
  { key: 'instances', label: '指标实例生成' },
  { key: 'tree', label: '指标树展示' },
  { key: 'query', label: '实例查询导出' },
  { key: 'versions', label: '版本管理' },
]

const themesForDomain = computed(() => {
  if (defForm.value.domainId === '') return themes.value
  return themes.value.filter((t) => String(t.domainId) === defForm.value.domainId)
})

const filteredSamples = computed(() => {
  return definitions.value.filter((d) => {
    if (sampleFilterDomain.value && String(d.domainId ?? d.domain_id ?? '') !== sampleFilterDomain.value) return false
    if (sampleFilterTheme.value && String(d.themeId ?? d.theme_id ?? '') !== sampleFilterTheme.value) return false
    if (sampleKeyword.value) {
      const kw = sampleKeyword.value.toLowerCase()
      const blob = [d.code, d.name, d.displayName, d.unit].map((x) => String(x || '').toLowerCase()).join(' ')
      if (!blob.includes(kw)) return false
    }
    return true
  })
})

const sampleThemesForFilter = computed(() => {
  if (!sampleFilterDomain.value) return themes.value
  return themes.value.filter((t) => String(t.domainId ?? t.domain_id ?? '') === sampleFilterDomain.value)
})


const filteredInstances = computed(() => {
  const base = queryHits.value.length ? queryHits.value : instances.value
  return base.filter((i) => {
    const okText =
      queryText.value === '' ||
      JSON.stringify(i).toLowerCase().includes(queryText.value.toLowerCase())
    const okStatus = queryStatus.value === '' || String(i.status || '') === queryStatus.value
    const okDef = queryDefId.value === '' || String(i.defId || i.definitionId || '') === queryDefId.value
    const okScale = queryScaleId.value === '' || String(i.scaleId || '') === queryScaleId.value
    return okText && okStatus && okDef && okScale
  })
})

function buildInstanceQuery() {
  const params = new URLSearchParams()
  if (queryText.value) params.set('keyword', queryText.value)
  if (queryStatus.value) params.set('status', queryStatus.value)
  if (queryDefId.value) params.set('defId', queryDefId.value)
  if (queryScaleId.value) params.set('scaleId', queryScaleId.value)
  const s = params.toString()
  return s ? '?' + s : ''
}

async function runInstanceQuery() {
  queryPending.value = true
  error.value = null
  try {
    const res = await api.listInstances(buildInstanceQuery())
    queryHits.value = res.data
    message.value = '服务端实例查询完成，命中 ' + res.data.length + ' 条'
  } catch (err) {
    error.value = errMessage(err, '实例查询失败')
  } finally {
    queryPending.value = false
  }
}

async function setTab(key: string) {
  tab.value = key
  await router.replace({ path: '/indicators', query: { tab: key } })
}

function syncTabFromRoute() {
  const q = route.query.tab
  if (typeof q === 'string' && tabs.some((t) => t.key === q)) tab.value = q
}

async function loadBase() {
  error.value = null
  try {
    const [d, th, sc, def, inst] = await Promise.all([
      api.listDomains(),
      api.listThemes(),
      api.listScales(),
      api.listDefinitions(),
      api.listInstances(),
    ])
    domains.value = d.data
    themes.value = th.data
    scales.value = sc.data
    definitions.value = def.data
    instances.value = inst.data
    if (defForm.value.domainId === '' && domains.value[0]) defForm.value.domainId = pickId(domains.value[0])
    if (defForm.value.themeId === '' && themesForDomain.value[0]) defForm.value.themeId = pickId(themesForDomain.value[0])
    if (instForm.value.scaleId === '' && scales.value[0]) instForm.value.scaleId = pickId(scales.value[0])
    if (instForm.value.defId === '' && definitions.value[0]) instForm.value.defId = pickId(definitions.value[0])
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
}

async function loadTree() {
  try {
    const res = await api.getIndicatorTree()
    const data = Array.isArray(res.data) ? res.data : []
    tree.value = data as Array<Record<string, unknown>>
    const open: Record<string, boolean> = { ...expandedDomains.value }
    for (const d of tree.value) {
      const k = String(d.id ?? d.code ?? '')
      if (k && open[k] === undefined) open[k] = true
    }
    expandedDomains.value = open
  } catch (err) {
    error.value = errMessage(err, '树加载失败')
  }
}

async function createSample() {
  if (defForm.value.code === '' || defForm.value.name === '' || defForm.value.domainId === '' || defForm.value.themeId === '') {
    error.value = '请填写编码、名称，并选择领域与主题'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.createDefinition({
      code: defForm.value.code,
      name: defForm.value.name,
      displayName: defForm.value.displayName || defForm.value.name,
      domainId: Number(defForm.value.domainId),
      themeId: Number(defForm.value.themeId),
      unit: defForm.value.unit || undefined,
      defaultAccuracy: Number(defForm.value.defaultAccuracy) || undefined,
    })
    message.value = '样例已创建'
    defForm.value.code = ''
    defForm.value.name = ''
    defForm.value.displayName = ''
    await loadBase()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

async function copySample(row: Record<string, unknown>) {
  pending.value = true
  error.value = null
  try {
    const codeBase = String(row.code || 'IND')
    await api.createDefinition({
      code: codeBase + '-COPY-' + Date.now().toString().slice(-6),
      name: String(row.name || '') + '（复制）',
      displayName: String(row.displayName || row.name || '') + '（复制）',
      domainId: Number(row.domainId),
      themeId: Number(row.themeId),
      unit: row.unit || undefined,
      defaultAccuracy: row.defaultAccuracy || undefined,
      changeSummary: '复制样例',
    })
    message.value = '样例已复制'
    await loadBase()
  } catch (err) {
    error.value = errMessage(err, '复制失败')
  } finally {
    pending.value = false
  }
}

async function removeSample(id: unknown) {
  if (window.confirm('确认删除该样例？') === false) return
  pending.value = true
  try {
    await api.deleteDefinition(String(id))
    message.value = '样例已删除'
    await loadBase()
  } catch (err) {
    error.value = errMessage(err, '删除失败')
  } finally {
    pending.value = false
  }
}

async function createInst() {
  if (instForm.value.defId === '' || instForm.value.instanceName === '' || instForm.value.scaleId === '') {
    error.value = '请选择样例、尺度，并填写实例名称'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.createInstance({
      defId: Number(instForm.value.defId),
      instanceName: instForm.value.instanceName,
      scaleId: Number(instForm.value.scaleId),
      timeStart: isoNow(-3600_000),
      timeEnd: isoNow(5 * 3600_000),
      resolution: Number(instForm.value.resolution),
      temporalRes: instForm.value.temporalRes,
      spatialWkt: instForm.value.spatialWkt,
      targetAccuracy: Number(instForm.value.targetAccuracy),
    })
    message.value = '实例已生成'
    try { await showIndicatorsWorkspace('/indicators') } catch { /* map refresh optional */ }
    instForm.value.instanceName = ''
    await loadBase()
  } catch (err) {
    error.value = errMessage(err, '生成失败')
  } finally {
    pending.value = false
  }
}

async function doExport() {
  try {
    exportPreview.value = await api.exportInstancesCsv(buildInstanceQuery())
    message.value = '导出完成（CSV，已应用当前筛选）'
  } catch (err) {
    error.value = errMessage(err, '导出失败')
  }
}

async function loadVersions() {
  versions.value = []
  if (versionDefId.value === '') {
    if (definitions.value[0]) versionDefId.value = pickId(definitions.value[0])
  }
  if (versionDefId.value === '') return
  try {
    const res = await api.listDefinitionVersions(versionDefId.value)
    versions.value = res.data
  } catch (err) {
    error.value = errMessage(err, '定义版本加载失败')
  }
}

async function loadInstanceVersions() {
  instanceVersions.value = []
  compareResult.value = null
  if (versionInstanceId.value === '') {
    if (instances.value[0]) versionInstanceId.value = pickId(instances.value[0])
  }
  if (versionInstanceId.value === '') return
  try {
    const res = await api.listInstanceVersions(versionInstanceId.value)
    instanceVersions.value = res.data
    const newest = instanceVersions.value[0]
    const oldest = instanceVersions.value[instanceVersions.value.length - 1]
    if (instanceVersions.value.length >= 2 && newest && oldest) {
      compareFrom.value = String(oldest.version ?? '')
      compareTo.value = String(newest.version ?? '')
    } else if (newest) {
      compareFrom.value = String(newest.version ?? '')
      compareTo.value = compareFrom.value
    }
  } catch (err) {
    error.value = errMessage(err, '实例版本加载失败')
  }
}

async function runCompareVersions() {
  if (versionInstanceId.value === '' || compareFrom.value === '' || compareTo.value === '') {
    error.value = '请选择实例及两个版本号'
    return
  }
  try {
    const res = await api.compareInstanceVersions(versionInstanceId.value, compareFrom.value, compareTo.value)
    compareResult.value = res.data
    message.value = '版本对比完成'
  } catch (err) {
    error.value = errMessage(err, '版本对比失败')
  }
}

async function runRollback(version: unknown) {
  if (versionInstanceId.value === '') return
  if (window.confirm('确认回退到版本 ' + version + '？将生成新版本记录。') === false) return
  pending.value = true
  error.value = null
  try {
    await api.rollbackInstanceVersion(versionInstanceId.value, String(version))
    message.value = '已回退到版本 ' + version
    await loadBase()
    await loadInstanceVersions()
  } catch (err) {
    error.value = errMessage(err, '回退失败')
  } finally {
    pending.value = false
  }
}


function canPublishInstance(status: unknown) {
  const s = String(status || '').toLowerCase()
  return s === 'draft' || s === 'active' || s === 'inactive' || s === ''
}
function canRetireInstance(status: unknown) {
  const s = String(status || '').toLowerCase()
  return s === 'published' || s === 'active'
}
function canRevertDraft(status: unknown) {
  const s = String(status || '').toLowerCase()
  return s === 'published' || s === 'inactive' || s === 'active'
}
function canDeleteInstance(status: unknown) {
  const s = String(status || '').toLowerCase()
  return s !== 'published'
}

async function setInstanceStatus(id: unknown, status: string) {
  try {
    const row = instances.value.find((i) => String(i.id) === String(id))
    const cur = row ? String(row.status || '') : ''
    if (status === 'published' && canPublishInstance(cur) === false) {
      error.value = '当前状态不可发布：' + (cur || '-')
      return
    }
    if (status === 'inactive' && canRetireInstance(cur) === false) {
      error.value = '当前状态不可停用：' + (cur || '-')
      return
    }
    if (status === 'draft' && canRevertDraft(cur) === false) {
      error.value = '当前状态不可回退草稿：' + (cur || '-')
      return
    }
    await api.updateInstance(String(id), { status })
    message.value = '实例状态已更新为 ' + status
    await loadBase()
    if (tab.value === 'versions') await loadInstanceVersions()
  } catch (err) {
    error.value = errMessage(err, '更新实例状态失败')
  }
}

async function removeInstance(id: unknown) {
  const row = instances.value.find((i) => String(i.id) === String(id))
  const st = String(row?.status || '').toLowerCase()
  if (st === 'published') {
    error.value = '已发布实例不能直接删除，请先停用或回退草稿'
    return
  }
  if (window.confirm('确认删除该实例？删除前将检查关联任务/数据。') === false) return
  try {
    await api.deleteInstance(String(id))
    message.value = '实例已删除'
    try { await showIndicatorsWorkspace('/indicators') } catch { /* map refresh optional */ }
    await loadBase()
  } catch (err) {
    error.value = errMessage(err, '删除实例失败')
  }
}


onMounted(async () => {
  syncTabFromRoute()
  await loadBase()
  if (tab.value === 'tree') await loadTree()
  if (tab.value === 'versions') { await loadVersions(); await loadInstanceVersions() }
})

watch(shellSelected, (v) => {
  if (!v || v.kind !== 'indicator') return
  // 仅高亮列表（selected class 已绑定 shellSelected）；必要时切到实例页
  if (tab.value !== 'instances' && tab.value !== 'query') {
    void setTab('instances')
  }
})

watch(() => route.query.tab, syncTabFromRoute)
watch(tab, async (v) => {
  if (v === 'tree') await loadTree()
  if (v === 'versions') { await loadVersions(); await loadInstanceVersions() }
})
watch(
  () => defForm.value.domainId,
  () => {
    const first = themesForDomain.value[0]
    if (first) defForm.value.themeId = pickId(first)
  },
)

async function showIndicatorsOnMap() {
  await showIndicatorsWorkspace('/indicators')
  message.value = `地图已加载指标实例 ${shellCounts.indicators} 个`
}


function domainList(): Array<Record<string, unknown>> {
  return Array.isArray(tree.value) ? tree.value : []
}

function themeList(domain: Record<string, unknown>): Array<Record<string, unknown>> {
  const themes = domain.themes
  return Array.isArray(themes) ? (themes as Array<Record<string, unknown>>) : []
}

function defList(theme: Record<string, unknown>): Array<Record<string, unknown>> {
  const defs = theme.definitions
  return Array.isArray(defs) ? (defs as Array<Record<string, unknown>>) : []
}

function subThemeList(theme: Record<string, unknown>): Array<Record<string, unknown>> {
  const subs = theme.subThemes || theme.sub_themes
  return Array.isArray(subs) ? (subs as Array<Record<string, unknown>>) : []
}

function instancesForDef(defId: unknown) {
  const id = String(defId ?? '')
  return instances.value.filter((i) => String(i.defId ?? i.definitionId ?? '') === id)
}

function isDomainOpen(id: unknown) {
  const key = String(id ?? '')
  const v = expandedDomains.value[key]
  return v === undefined ? true : v
}
function toggleDomain(id: unknown) {
  const key = String(id ?? '')
  expandedDomains.value = { ...expandedDomains.value, [key]: !isDomainOpen(key) }
}
function isThemeOpen(id: unknown) {
  const key = String(id ?? '')
  const v = expandedThemes.value[key]
  return v === undefined ? true : v
}
function toggleTheme(id: unknown) {
  const key = String(id ?? '')
  expandedThemes.value = { ...expandedThemes.value, [key]: !isThemeOpen(key) }
}
function isDefOpen(id: unknown) {
  const key = String(id ?? '')
  if (selectedTreeDefId.value === key) return true
  const v = expandedDefs.value[key]
  return v === undefined ? false : v
}
function toggleDef(id: unknown) {
  const key = String(id ?? '')
  expandedDefs.value = { ...expandedDefs.value, [key]: !isDefOpen(key) }
}

async function locateDefinitionOnMap(defId: unknown) {
  const id = String(defId ?? '')
  selectedTreeDefId.value = id
  expandedDefs.value = { ...expandedDefs.value, [id]: true }
  error.value = null
  try {
    await showIndicatorsWorkspace('/indicators')
  } catch {
    /* optional */
  }
  const list = instancesForDef(id)
  if (!list.length) {
    message.value = '样例 #' + id + ' 下暂无指标实例'
    return
  }
  const withGeom = list.find((i) => String(i.spatialWkt || i.spatial_wkt || '').trim())
  const target = withGeom ?? list[0]
  if (!target) {
    message.value = '样例 #' + id + ' 下暂无可用实例'
    return
  }
  await locateInstanceOnMap(target.id)
  message.value = '样例 #' + id + ' 共 ' + list.length + ' 个实例，已定位 ' + String(target.instanceName || target.id)
}

async function locateInstanceOnMap(id: string | number | unknown) {
  // 指标范围图层不受 showSensors/Data/Tasks 控制，确保实例已加载后定位
  const ok = await selectShellFeature('indicator', String(id), { openBubble: true, fly: true })
  message.value = ok
    ? `已在地图定位指标实例 #${id}`
    : `地图未找到指标实例 #${id} 的空间范围（请确认已填写 spatialWkt）`
  if (!ok) error.value = message.value
  else error.value = null
}

</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">感知指标中心</p>
        <h1>指标样例、实例与版本管理</h1>
        <p class="muted">对应任务清单：指标样例、实例化、树形查询、条件查询导出、版本追溯。</p>
      </div>
    </header>

    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <section v-show="tab === 'samples'" class="panel">
      <h2>指标样例维护</h2>
      <p class="muted">支持新增/删除/修改/查看/复制与按领域-主题分类管理。</p>
      <div class="form-row">
        <label>筛选领域
          <select v-model="sampleFilterDomain" @change="sampleFilterTheme = ''">
            <option value="">全部领域</option>
            <option v-for="d in domains" :key="'fd'+d.id" :value="String(d.id)">{{ d.name }}</option>
          </select>
        </label>
        <label>筛选主题
          <select v-model="sampleFilterTheme">
            <option value="">全部主题</option>
            <option v-for="t in sampleThemesForFilter" :key="'ft'+t.id" :value="String(t.id)">{{ t.name }}</option>
          </select>
        </label>
        <label>关键字<input v-model="sampleKeyword" placeholder="编码/名称" /></label>
        <span class="muted">显示 {{ filteredSamples.length }} / {{ definitions.length }}</span>
      </div>
      <div class="form-row">
        <label>编码<input v-model="defForm.code" placeholder="唯一编码" /></label>
        <label>名称<input v-model="defForm.name" /></label>
        <label>显示名<input v-model="defForm.displayName" /></label>
        <label>领域
          <select v-model="defForm.domainId">
            <option v-for="d in domains" :key="String(d.id)" :value="String(d.id)">{{ d.name }}</option>
          </select>
        </label>
        <label>主题
          <select v-model="defForm.themeId">
            <option v-for="t in themesForDomain" :key="String(t.id)" :value="String(t.id)">{{ t.name }}</option>
          </select>
        </label>
        <label>单位<input v-model="defForm.unit" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createSample">新增样例</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>名称</th><th>领域</th><th>主题</th><th></th></tr></thead>
        <tbody>
          <tr v-for="d in filteredSamples" :key="String(d.id)">
            <td>{{ d.id }}</td>
            <td><code>{{ d.code }}</code></td>
            <td>{{ d.displayName || d.name }}</td>
            <td>{{ d.domainId }}</td>
            <td>{{ d.themeId }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click="copySample(d)">复制</button>
              <button class="btn ghost" type="button" @click.stop="removeSample(d.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="tab === 'instances'" class="panel">
      <h2>指标实例生成</h2>
      <div class="form-row">
        <label>样例
          <select v-model="instForm.defId">
            <option v-for="d in definitions" :key="'def'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name }}</option>
          </select>
        </label>
        <label>实例名称<input v-model="instForm.instanceName" /></label>
        <label>尺度
          <select v-model="instForm.scaleId">
            <option v-for="s in scales" :key="'sc'+s.id" :value="String(s.id)">{{ s.name }}</option>
          </select>
        </label>
        <label>空间WKT<input v-model="instForm.spatialWkt" /></label>
            <button class="btn ghost" type="button" @click="applyMapDrawWkt">写入地图绘制范围</button>
        <label>分辨率<input v-model.number="instForm.resolution" type="number" /></label>
        <label>目标精度<input v-model.number="instForm.targetAccuracy" type="number" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createInst">生成实例</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>样例</th><th>尺度</th><th>定义版本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="i in instances" :key="String(i.id)" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'indicator' && shellSelected.id === String(i.id) }" @click="locateInstanceOnMap(String(i.id))">
            <td>{{ i.id }}</td>
            <td>{{ i.instanceName }}</td>
            <td>{{ i.defId }}</td>
            <td>{{ i.scaleId }}</td>
            <td>{{ i.definitionVersion || i.definition_version || '-' }}</td>
            <td>{{ i.status || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'published')" :disabled="canPublishInstance(i.status) === false">发布</button>
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'inactive')" :disabled="canRetireInstance(i.status) === false">停用</button>
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'draft')" :disabled="canRevertDraft(i.status) === false">回退草稿</button>
              <button class="btn ghost" type="button" @click.stop="removeInstance(i.id)" :disabled="canDeleteInstance(i.status) === false">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="tab === 'tree'" class="panel">
      <div class="form-row" style="margin-bottom:0.6rem">
        <button class="btn" type="button" :disabled="shellLoading" @click="showIndicatorsOnMap">指标范围上图</button>
        <button class="btn ghost" type="button" @click="loadTree">刷新树</button>
        <span class="muted">{{ shellStatus }} · 指标 {{ shellCounts.indicators }} · 实例库 {{ instances.length }}</span>
      </div>
      <h2>指标树（领域—主题—样例—实例）</h2>
      <p class="muted">点击样例或实例：地图定位并高亮对应空间范围。</p>
      <div v-if="!domainList().length" class="muted">暂无树数据，请先维护领域/主题/样例。</div>
      <ul v-else class="ind-tree">
        <li v-for="domain in domainList()" :key="'d'+domain.id" class="ind-tree-domain">
          <button type="button" class="tree-row domain" @click="toggleDomain(domain.id)">
            <span class="tree-caret">{{ isDomainOpen(domain.id) ? '▼' : '▶' }}</span>
            <strong>{{ domain.name || domain.code }}</strong>
            <span class="muted">领域</span>
          </button>
          <ul v-show="isDomainOpen(domain.id)">
            <li v-for="theme in themeList(domain)" :key="'t'+theme.id" class="ind-tree-theme">
              <button type="button" class="tree-row theme" @click="toggleTheme(theme.id)">
                <span class="tree-caret">{{ isThemeOpen(theme.id) ? '▼' : '▶' }}</span>
                <strong>{{ theme.name || theme.code }}</strong>
                <span class="muted">主题</span>
              </button>
              <ul v-show="isThemeOpen(theme.id)">
                <li v-for="def in defList(theme)" :key="'def'+def.id" class="ind-tree-def">
                  <button
                    type="button"
                    class="tree-row def"
                    :class="{ active: selectedTreeDefId === String(def.id) }"
                    @click="toggleDef(def.id); locateDefinitionOnMap(def.id)"
                  >
                    <span class="tree-caret">{{ isDefOpen(def.id) ? '▼' : '▶' }}</span>
                    <strong>{{ def.name || def.code }}</strong>
                    <span class="muted">样例 · {{ def.unit || '-' }} · 实例 {{ instancesForDef(def.id).length }}</span>
                  </button>
                  <ul v-show="isDefOpen(def.id)">
                    <li v-for="inst in instancesForDef(def.id)" :key="'i'+inst.id">
                      <button
                        type="button"
                        class="tree-row inst"
                        :class="{ selected: shellSelected && shellSelected.kind === 'indicator' && shellSelected.id === String(inst.id) }"
                        @click.stop="locateInstanceOnMap(inst.id)"
                      >
                        <span class="dot" :class="String(inst.status || '')"></span>
                        {{ inst.instanceName || ('实例#' + inst.id) }}
                        <span class="muted">{{ inst.status || '-' }}</span>
                      </button>
                    </li>
                    <li v-if="!instancesForDef(def.id).length" class="muted tree-empty">暂无实例</li>
                  </ul>
                </li>
                <li v-for="sub in subThemeList(theme)" :key="'st'+sub.id" class="ind-tree-theme">
                  <button type="button" class="tree-row theme" @click="toggleTheme('sub-'+String(sub.id))">
                    <span class="tree-caret">{{ isThemeOpen('sub-'+String(sub.id)) ? '▼' : '▶' }}</span>
                    <strong>{{ sub.name || sub.code }}</strong>
                    <span class="muted">子主题</span>
                  </button>
                  <ul v-show="isThemeOpen('sub-'+String(sub.id))">
                    <li v-for="def in defList(sub)" :key="'sdef'+def.id" class="ind-tree-def">
                      <button
                        type="button"
                        class="tree-row def"
                        :class="{ active: selectedTreeDefId === String(def.id) }"
                        @click="toggleDef(def.id); locateDefinitionOnMap(def.id)"
                      >
                        <span class="tree-caret">{{ isDefOpen(def.id) ? '▼' : '▶' }}</span>
                        <strong>{{ def.name || def.code }}</strong>
                        <span class="muted">样例 · 实例 {{ instancesForDef(def.id).length }}</span>
                      </button>
                      <ul v-show="isDefOpen(def.id)">
                        <li v-for="inst in instancesForDef(def.id)" :key="'si'+inst.id">
                          <button
                            type="button"
                            class="tree-row inst"
                            :class="{ selected: shellSelected && shellSelected.kind === 'indicator' && shellSelected.id === String(inst.id) }"
                            @click.stop="locateInstanceOnMap(inst.id)"
                          >
                            <span class="dot" :class="String(inst.status || '')"></span>
                            {{ inst.instanceName || ('实例#' + inst.id) }}
                            <span class="muted">{{ inst.status || '-' }}</span>
                          </button>
                        </li>
                        <li v-if="!instancesForDef(def.id).length" class="muted tree-empty">暂无实例</li>
                      </ul>
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section v-show="tab === 'query'" class="panel">
      <h2>实例查询与导出</h2>
      <p class="muted">查询对象仅为指标实例。支持按样例、尺度、状态、名称关键字服务端筛选，并可导出当前条件结果。</p>
      <div class="form-row">
        <label>关键字<input v-model="queryText" placeholder="实例名称" /></label>
        <label>状态<input v-model="queryStatus" placeholder="draft/published/inactive" /></label>
        <label>样例
          <select v-model="queryDefId">
            <option value="">全部</option>
            <option v-for="d in definitions" :key="'qd'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name || d.displayName }}</option>
          </select>
        </label>
        <label>尺度
          <select v-model="queryScaleId">
            <option value="">全部</option>
            <option v-for="s in scales" :key="'qs'+s.id" :value="String(s.id)">{{ s.name }}</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="queryPending" @click="runInstanceQuery">服务端查询</button>
        <button class="btn ghost" type="button" @click="doExport">导出 CSV</button>
        <button class="btn ghost" type="button" @click="queryHits = []; message = '已重置为本地列表'">重置</button>
      </div>
      <p class="muted">命中 {{ filteredInstances.length }} 条（服务端 {{ queryHits.length }} / 本地 {{ instances.length }}）</p>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>样例</th><th>尺度</th><th>状态</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="i in filteredInstances" :key="'q'+i.id" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'indicator' && shellSelected.id === String(i.id) }" @click="locateInstanceOnMap(String(i.id))">
            <td>{{ i.id }}</td>
            <td>{{ i.instanceName }}</td>
            <td>{{ i.defId || i.definitionId }}</td>
            <td>{{ i.scaleId }}</td>
            <td>{{ i.status || '-' }}</td>
            <td>{{ i.timeStart }} ~ {{ i.timeEnd }}</td>
          </tr>
        </tbody>
      </table>
      <pre v-if="exportPreview" class="result-pre">{{ exportPreview.slice(0, 3000) }}</pre>
    </section>

    <section v-show="tab === 'versions'" class="panel">
      <h2>指标实例版本管理</h2>
      <p class="muted">文档验收：记录实例生成/修改/发布/停用，支持版本对比、历史追溯与回退。定义版本用于追溯样例模板变更。</p>

      <h3>1) 实例版本历史</h3>
      <div class="form-row">
        <label>指标实例
          <select v-model="versionInstanceId" @change="loadInstanceVersions">
            <option v-for="i in instances" :key="'vi'+i.id" :value="String(i.id)">#{{ i.id }} {{ i.instanceName }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="loadInstanceVersions">刷新实例版本</button>
      </div>
      <table class="table">
        <thead><tr><th>版本</th><th>状态快照</th><th>变更说明</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="v in instanceVersions" :key="'iv'+v.id">
            <td>v{{ v.version }}</td>
            <td>{{ v.status }}</td>
            <td>{{ v.changeSummary || '-' }}</td>
            <td>{{ v.createdAt || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click="runRollback(v.version)">回退到此版本</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>2) 版本对比</h3>
      <div class="form-row">
        <label>从版本
          <select v-model="compareFrom">
            <option v-for="v in instanceVersions" :key="'cf'+v.version" :value="String(v.version)">v{{ v.version }}</option>
          </select>
        </label>
        <label>到版本
          <select v-model="compareTo">
            <option v-for="v in instanceVersions" :key="'ct'+v.version" :value="String(v.version)">v{{ v.version }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="runCompareVersions">对比</button>
      </div>
      <pre v-if="compareResult" class="result-pre">{{ JSON.stringify(compareResult, null, 2).slice(0, 4000) }}</pre>

      <h3>3) 样例定义版本（模板追溯）</h3>
      <div class="form-row">
        <label>样例
          <select v-model="versionDefId" @change="loadVersions">
            <option v-for="d in definitions" :key="'vd'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.code || d.name }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="loadVersions">刷新定义版本（次要）</button>
      </div>
      <table class="table">
        <thead><tr><th>版本</th><th>变更说明</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="String(v.id || v.version)">
            <td>{{ v.version }}</td>
            <td>{{ v.changeSummary || v.summary || '-' }}</td>
            <td>{{ v.createdAt || v.created_at || '-' }}</td>
          </tr>
        </tbody>
      </table>

      <h3>4) 实例状态快捷操作</h3>
      <table class="table">
        <thead><tr><th>实例ID</th><th>名称</th><th>定义版本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="i in instances" :key="'ver'+i.id">
            <td>{{ i.id }}</td>
            <td>{{ i.instanceName }}</td>
            <td>{{ i.definitionVersion || '-' }}</td>
            <td>{{ i.status || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'published'); versionInstanceId = String(i.id); loadInstanceVersions()" :disabled="canPublishInstance(i.status) === false">发布</button>
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'inactive'); versionInstanceId = String(i.id); loadInstanceVersions()">停用</button>
              <button class="btn ghost" type="button" @click.stop="setInstanceStatus(i.id, 'draft'); versionInstanceId = String(i.id); loadInstanceVersions()">回退草稿</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
