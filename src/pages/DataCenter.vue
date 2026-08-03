<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import {
  applyShellDataQualityFilter,
  reloadShellLayers,
  showShellAndFit,
  selectShellFeature,
  setShellVisibility,
  shellCounts,
  shellLoading,
  shellSelected,
  setDataTimeWindow,
  clearDataTimeWindow,
  getCachedDataTimeExtent,
  shellStatus,
  setDataLayerStyle,
} from '../gis/mapShell'
import { mapDrawGeometry } from '../gis/mapTools'
import { wktToGeoJson, type SimpleGeometry } from '../gis/wkt'
import { canByStatus, errMessage, isoNow, pickId } from '../utils/errors'
import { tablePager as vTablePager } from '../utils/tablePager'

const route = useRoute()
const router = useRouter()
const tab = ref('query')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)
const detail = ref<unknown>(null)

const datasets = ref<Record<string, unknown>[]>([])
const dataList = ref<Record<string, unknown>[]>([])
const sources = ref<Record<string, unknown>[]>([])
const imports = ref<Record<string, unknown>[]>([])
const platforms = ref<Record<string, unknown>[]>([])
const exportPreview = ref('')
const q = ref('')
const qType = ref('')
const qQuality = ref('')
const qDatasetId = ref('')
const qPlatformId = ref('')
const queryServerHits = ref<Record<string, unknown>[]>([])
const queryPage = ref(1)
const queryPageSize = ref(4)
const queryTotal = ref(0)
const serverQueryActive = ref(false)
const crudPage = ref(1)
const sourcePage = ref(1)
const editingDataId = ref('')
const editingSourceId = ref('')
const queryViewPage = ref(1)
const vizPage = ref(1)
const crudPages = computed(() => ['数据集', editingDataId.value ? '编辑监测数据' : '新增监测数据', '监测数据列表'])
const sourcePages = computed(() => ['通道说明', editingSourceId.value ? '编辑数据源基础' : '数据源基础', '鉴权与参数', '数据源管理', '即时拉取', '定时接入', '接入状态', '接入审计', '文件信息', '导入设置', '导入任务'])
const queryViewPages = ['查询条件', '查询结果']
const vizPages = ['时间与上图', '数据概览', '质量分布']

const datasetForm = ref({ code: '', name: '' })
const dataForm = ref({
  datasetId: '',
  platformId: '',
  name: '',
  dataType: 'observation',
  sourceName: 'demo-source',
  dataFormat: 'json',
  spatialGeoJson: null as SimpleGeometry | null,
  version: 1,
})
const sourceForm = ref({
  code: '',
  name: '',
  platformId: '',
  protocol: 'https',
  endpointAddress: 'internal://sample-live-feed',
  authMethod: 'none',
  credentialReference: '',
  connectionParametersText: '{"headers":{"Accept":"application/json"}}',
  fieldMappingText:
    '{"recordsPath":"items","sourceRecordId":"id","observedAt":"observedAt","valueFields":["value","temperature","humidity"]}',
  ingestionStrategyText: '{"mode":"pull","intervalSeconds":60}',
})
const pullForm = ref({
  sourceId: '',
  datasetId: '',
  dataName: '',
  dataType: 'timeseries',
  spatialGeoJson: null as SimpleGeometry | null,
})
const sourceAudits = ref<Record<string, unknown>[]>([])
const selectedAuditSourceId = ref('')
const liveStatus = ref<Record<string, unknown> | null>(null)
let lastLivePullCount: number | null = null
let livePollTimer: number | null = null

function stopLivePolling() {
  if (livePollTimer != null) {
    window.clearInterval(livePollTimer)
    livePollTimer = null
  }
}

function startLivePolling(sourceId?: string) {
  stopLivePolling()
  const id = sourceId || pullForm.value.sourceId
  if (!id) return
  livePollTimer = window.setInterval(() => {
    void refreshLiveStatus(String(id))
  }, 4000)
}


function sourceStatusLabel(status: unknown) {
  const s = String(status || '').toLowerCase()
  const map: Record<string, string> = {
    enabled: '已启用',
    disabled: '已停用',
    active: '运行中',
    error: '异常',
    failed: '失败',
  }
  return map[s] || String(status || '-')
}

function liveStatusLabel(status: unknown) {
  const s = String(status || '').toLowerCase()
  const map: Record<string, string> = {
    idle: '空闲',
    running: '定时接入中',
    stopped: '已停止',
    error: '异常',
    failed: '失败',
  }
  return map[s] || String(status || '-')
}


async function locateLatestLiveOnMap() {
  const id = (liveStatus.value as any)?.lastObservationDataId
  if (id == null || id === '' || id === '-') {
    error.value = '当前没有最近观测数据可定位'
    return
  }
  try {
    await showDataOnMap()
    const ok = await selectShellFeature('data', String(id), { openBubble: true, fly: true })
    message.value = ok ? `已定位最近实时观测 #${id}` : `地图未找到观测 #${id}`
  } catch (err) {
    error.value = errMessage(err, '定位实时观测失败')
  }
}

function liveStatusClass(status: unknown) {
  const s = String(status || '').toLowerCase()
  if (s === 'running') return 'live-dot running'
  if (s === 'error' || s === 'failed') return 'live-dot error'
  if (s === 'stopped') return 'live-dot stopped'
  return 'live-dot idle'
}

const liveIntervalSeconds = ref(60)
const timeMin = ref(0)
const timeMax = ref(0)
const timeCursor = ref(0)
const timeWindowHours = ref(24)
const timePlaying = ref(false)
const timeFilterActive = ref(false)
const mapDisplayMode = ref<'all' | 'heat' | 'points'>('all')
const mapQualityFilter = ref('')
let timePlayTimer: number | null = null

function stopTimePlayback() {
  timePlaying.value = false
  if (timePlayTimer != null) {
    window.clearInterval(timePlayTimer)
    timePlayTimer = null
  }
}

function formatTimeLabel(ms: number) {
  if (!ms) return '-'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function collectDataTimes(): number[] {
  const times: number[] = []
  for (const row of dataList.value) {
    const raw = row.observedAt || row.timeStart || row.time_start || (row as any).properties?.observedAt
    if (raw == null || raw === '') continue
    const t = Date.parse(String(raw))
    if (Number.isFinite(t)) times.push(t)
  }
  const ext = getCachedDataTimeExtent()
  if (ext) {
    times.push(ext.min, ext.max)
  }
  return times
}

function refreshTimeExtent() {
  const times = collectDataTimes()
  if (!times.length) {
    timeMin.value = 0
    timeMax.value = 0
    timeCursor.value = 0
    return
  }
  timeMin.value = Math.min(...times)
  timeMax.value = Math.max(...times)
  if (!timeCursor.value || timeCursor.value < timeMin.value || timeCursor.value > timeMax.value) {
    timeCursor.value = timeMax.value
  }
}

async function applyTimeFilterOnMap() {
  refreshTimeExtent()
  if (!timeMin.value || !timeMax.value) {
    error.value = '暂无带时间戳的监测数据，无法启用时间轴'
    return
  }
  const end = Number(timeCursor.value) || timeMax.value
  const win = Math.max(1, Number(timeWindowHours.value) || 24) * 3600_000
  const start = Math.max(timeMin.value, end - win)
  timeFilterActive.value = true
  await setDataTimeWindow(start, end, { fit: false })
  message.value = `时间轴过滤：${formatTimeLabel(start)} ~ ${formatTimeLabel(end)}（窗口 ${timeWindowHours.value} 小时）`
}

async function clearTimeFilterOnMap() {
  stopTimePlayback()
  timeFilterActive.value = false
  await clearDataTimeWindow({ fit: false })
  message.value = '已清除时间轴过滤，显示全部数据图层'
}

function toggleTimePlayback() {
  if (timePlaying.value) {
    stopTimePlayback()
    message.value = '时间轴播放已暂停'
    return
  }
  refreshTimeExtent()
  if (!timeMax.value) {
    error.value = '暂无时间范围可播放'
    return
  }
  timePlaying.value = true
  if (!timeCursor.value) timeCursor.value = timeMin.value || timeMax.value
  timePlayTimer = window.setInterval(() => {
    const step = Math.max(60_000, Math.floor((timeMax.value - timeMin.value) / 40) || 3600_000)
    let next = Number(timeCursor.value) + step
    if (next > timeMax.value) next = timeMin.value
    timeCursor.value = next
    void applyTimeFilterOnMap()
  }, 1200)
  message.value = '时间轴播放中（循环）'
  void applyTimeFilterOnMap()
}

const importForm = ref({
  datasetId: '',
  platformId: '',
  dataSourceId: '',
  dataName: '',
  dataType: 'observation',
  sourceName: 'file-import',
  spatialGeoJson: null as SimpleGeometry | null,
  version: 1,
  duplicateStrategy: 'reject',
  executeNow: true,
})
const importFile = ref<File | null>(null)

const tabs = [
  { key: 'sources', label: '数据资源建模与接入' },
  { key: 'query', label: '观测数据管理' },
]

const filtered = computed(() => {
  const base = serverQueryActive.value ? queryServerHits.value : dataList.value
  return base.filter((d) => {
    const okQ = q.value === '' || JSON.stringify(d).includes(q.value)
    const okType = qType.value === '' || String(d.dataType || '') === qType.value
    const okQlt = qQuality.value === '' || String(d.qualityStatus || '') === qQuality.value
    const okDs = qDatasetId.value === '' || String(d.datasetId || '') === qDatasetId.value
    const okPl = qPlatformId.value === '' || String(d.platformId || '') === qPlatformId.value
    return okQ && okType && okQlt && okDs && okPl
  })
})
const dataQueryCount = computed(() => serverQueryActive.value ? queryTotal.value : filtered.value.length)
const dataQueryPageCount = computed(() => Math.max(1, Math.ceil(dataQueryCount.value / queryPageSize.value)))
const displayedData = computed(() => serverQueryActive.value
  ? filtered.value
  : filtered.value.slice((queryPage.value - 1) * queryPageSize.value, queryPage.value * queryPageSize.value))
const dataQueryPageLabels = computed(() => Array.from({ length: dataQueryPageCount.value }, (_, index) => `监测数据第 ${index + 1} 页`))

function buildDataQueryString(forExport = false) {
  const params = new URLSearchParams()
  if (q.value) params.set('keyword', q.value)
  if (qType.value) params.set('dataType', qType.value)
  if (qQuality.value) params.set('qualityStatus', qQuality.value)
  if (qDatasetId.value) params.set('datasetId', qDatasetId.value)
  if (qPlatformId.value) params.set('platformId', qPlatformId.value)
  params.set('includeQuarantined', 'true')
  // 列表查询启用服务端分页；导出不带 page，尽量拉全量条件结果
  if (!forExport) {
    params.set('page', String(queryPage.value))
    params.set('pageSize', String(queryPageSize.value))
  }
  const s = params.toString()
  return s ? '?' + s : ''
}

async function runDataQuery(resetPage = false) {
  clearAlerts()
  if (resetPage) queryPage.value = 1
  pending.value = true
  try {
    const res = await api.listObservationData(buildDataQueryString(false))
    queryServerHits.value = res.data
    queryTotal.value = Number((res as { total?: number }).total ?? res.data.length)
    queryPage.value = Number((res as { page?: number }).page ?? queryPage.value)
    queryPageSize.value = Number((res as { pageSize?: number }).pageSize ?? queryPageSize.value)
    serverQueryActive.value = true
    if (resetPage) queryViewPage.value = 2
    message.value =
      '服务端综合查询完成：本页 ' +
      res.data.length +
      ' 条 / 共 ' +
      queryTotal.value +
      ' 条（第 ' +
      queryPage.value +
      ' 页）'
  } catch (err) {
    error.value = errMessage(err, '查询失败')
  } finally {
    pending.value = false
  }
}

async function setDataPage(page: number) {
  const next = Math.min(dataQueryPageCount.value, Math.max(1, page))
  if (next === queryPage.value) return
  queryPage.value = next
  if (serverQueryActive.value) await runDataQuery(false)
}

async function resetDataQuery() {
  q.value = ''
  qType.value = ''
  qQuality.value = ''
  qDatasetId.value = ''
  qPlatformId.value = ''
  queryServerHits.value = []
  queryTotal.value = 0
  queryPage.value = 1
  serverQueryActive.value = false
  await runDataQuery(true)
  if (!error.value) message.value = '查询条件已重置，已重新读取服务端监测数据'
}

function clearAlerts() {
  error.value = null
  message.value = null
}

async function setTab(key: string) {
  tab.value = key
  const q: Record<string, string> = { ...Object.fromEntries(
    Object.entries(route.query).filter(([, v]) => v != null && !Array.isArray(v)).map(([k, v]) => [k, String(v)]),
  ), tab: key }
  await router.replace({ path: route.path, query: q })
}
function syncTab() {
  const t = route.query.tab
  if (typeof t === 'string' && tabs.some((x) => x.key === t)) tab.value = t
}


function platformGeometry(platformId: unknown): SimpleGeometry | null {
  const platform = platforms.value.find((item) => String(item.id) === String(platformId))
  if (!platform) return null
  if (String(platform.platformTypeCode || '') === 'satellite') return null
  const geojson = platform.locationGeoJson
  if (geojson && typeof geojson === 'object') return geojson as SimpleGeometry
  return wktToGeoJson(
    String(platform.locationWkt || (platform.spatial as { positionWkt?: string } | undefined)?.positionWkt || ''),
  )
}

function isSatellitePlatform(platformId: unknown) {
  const platform = platforms.value.find((item) => String(item.id) === String(platformId))
  return String(platform?.platformTypeCode || '') === 'satellite'
}

function isFootprintGeometry(geometry: SimpleGeometry | null) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
}

function applyMapDrawSpatial(target: 'data' | 'live' | 'import') {
  const g = mapDrawGeometry.value
  if (!g || !g.geojson) {
    error.value = '请先用地图工具绘点/绘面，再写入接入空间条件'
    return
  }
  let geometry = g.geojson as SimpleGeometry
  const platformId = target === 'data'
    ? dataForm.value.platformId
    : target === 'import'
      ? importForm.value.platformId
      : ''
  if (platformId && isSatellitePlatform(platformId) && !isFootprintGeometry(geometry)) {
    error.value = '卫星遥感观测必须绘制影像覆盖面，不能用卫星点位代替'
    return
  }
  if (target === 'live' && g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const delta = 0.08
    geometry = {
      type: 'Polygon',
      coordinates: [[
        [lon - delta, lat - delta],
        [lon + delta, lat - delta],
        [lon + delta, lat + delta],
        [lon - delta, lat + delta],
        [lon - delta, lat - delta],
      ]],
    }
  }
  if (target === 'data') dataForm.value.spatialGeoJson = geometry
  else if (target === 'import') importForm.value.spatialGeoJson = geometry
  else pullForm.value.spatialGeoJson = geometry
  message.value = '已采用地图绘制的空间位置'
  error.value = null
}

async function load() {
  error.value = null
  try {
    const [ds, d, s, f, p] = await Promise.all([
      api.listDatasets(),
      api.listObservationData(),
      api.listDataSources(),
      api.listFileImports(),
      api.listPlatforms(),
    ])
    datasets.value = ds.data
    dataList.value = d.data
    refreshTimeExtent()
    sources.value = s.data
    imports.value = f.data
    platforms.value = p.data
    if (dataForm.value.datasetId === '' && datasets.value[0]) dataForm.value.datasetId = pickId(datasets.value[0])
    if (dataForm.value.platformId === '' && platforms.value[0]) dataForm.value.platformId = pickId(platforms.value[0])
    if (sourceForm.value.platformId === '' && platforms.value[0]) sourceForm.value.platformId = pickId(platforms.value[0])
    if (pullForm.value.datasetId === '' && datasets.value[0]) pullForm.value.datasetId = pickId(datasets.value[0])
    if (importForm.value.datasetId === '' && datasets.value[0]) importForm.value.datasetId = pickId(datasets.value[0])
    if (importForm.value.platformId === '' && platforms.value[0]) importForm.value.platformId = pickId(platforms.value[0])
    // 优先选中已启用的 sample/活接入通道，便于演示多源接入
    if (sources.value.length) {
      const preferred =
        sources.value.find((s) => String(s.protocol || '').toLowerCase() === 'sample' && String(s.status || '').toLowerCase() === 'enabled') ||
        sources.value.find((s) => String(s.status || '').toLowerCase() === 'enabled') ||
        sources.value[0]
      if (preferred) {
        const sid = pickId(preferred)
        if (selectedAuditSourceId.value === '') selectedAuditSourceId.value = sid
        if (pullForm.value.sourceId === '') pullForm.value.sourceId = sid
      }
    }
    if (pullForm.value.datasetId === '' && datasets.value[0]) {
      pullForm.value.datasetId = pickId(datasets.value[0])
    }
    if (pullForm.value.sourceId) {
      void refreshLiveStatus(pullForm.value.sourceId)
    }
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
}

async function createDataset() {
  if (datasetForm.value.code === '' || datasetForm.value.name === '') {
    error.value = '请填写数据集编码和名称'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    await api.createDataset({ code: datasetForm.value.code, name: datasetForm.value.name })
    message.value = '数据集已创建'
    try { await reloadShellLayers('/data', {}) } catch { /* 地图刷新失败不影响主流程 */ }
    datasetForm.value = { code: '', name: '' }
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建数据集失败')
  } finally {
    pending.value = false
  }
}

async function createData() {
  if (dataForm.value.datasetId === '' || dataForm.value.platformId === '' || dataForm.value.name === '') {
    error.value = '请选择数据集、平台并填写名称'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    const spatialGeoJson =
      dataForm.value.spatialGeoJson || platformGeometry(dataForm.value.platformId)
    if (!spatialGeoJson) {
      error.value = isSatellitePlatform(dataForm.value.platformId)
        ? '请绘制或接入遥感影像的真实覆盖面'
        : '请先在地图设置数据位置，或为关联平台维护位置'
      return
    }
    if (isSatellitePlatform(dataForm.value.platformId) && !isFootprintGeometry(spatialGeoJson)) {
      error.value = '卫星遥感观测范围必须是 Polygon 或 MultiPolygon'
      return
    }
    const body: Record<string, unknown> = {
      datasetId: Number(dataForm.value.datasetId),
      platformId: Number(dataForm.value.platformId),
      name: dataForm.value.name,
      dataType: dataForm.value.dataType,
      sourceName: dataForm.value.sourceName,
      dataFormat: dataForm.value.dataFormat,
      spatialGeoJson,
      version: Number(dataForm.value.version) || 1,
    }
    if (editingDataId.value) await api.updateObservationData(editingDataId.value, body)
    else await api.createObservationData({ ...body, timeStart: isoNow(-7200_000), timeEnd: isoNow() })
    message.value = editingDataId.value ? '监测数据修改已保存' : '监测数据已创建'
    editingDataId.value = ''
    try { await reloadShellLayers('/data', {}) } catch { /* 地图刷新失败不影响主流程 */ }
    dataForm.value.name = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

async function removeData(id: unknown) {
  if (window.confirm('确认删除该监测数据？') === false) return
  clearAlerts()
  try {
    await api.deleteObservationData(String(id))
    message.value = '已删除'
    try { await reloadShellLayers('/data', {}) } catch { /* 地图刷新失败不影响主流程 */ }
    await load()
  } catch (err) {
    error.value = errMessage(err, '删除失败')
  }
}

async function runQuality(id: unknown) {
  clearAlerts()
  try {
    const res = await api.qualityCheckData(String(id))
    detail.value = res.data
    message.value = '质量检查完成'
    await load()
  } catch (err) {
    error.value = errMessage(err, '质量检查失败')
  }
}

async function doQuarantine(id: unknown) {
  clearAlerts()
  try {
    await api.quarantineData(String(id))
    message.value = '已隔离'
    await load()
  } catch (err) {
    error.value = errMessage(err, '隔离失败')
  }
}

async function doRelease(id: unknown) {
  clearAlerts()
  try {
    await api.releaseData(String(id))
    message.value = '已放行'
    await load()
  } catch (err) {
    error.value = errMessage(err, '放行失败')
  }
}

async function showProvenance(id: unknown) {
  clearAlerts()
  try {
    const res = await api.dataProvenance(String(id))
    detail.value = res.data
    message.value = '已加载溯源信息'
  } catch (err) {
    error.value = errMessage(err, '溯源加载失败')
  }
}

async function showSpatial(id: unknown) {
  clearAlerts()
  try {
    const res = await api.spatialPreviewData(String(id))
    detail.value = res.data
    await selectShellFeature('data', String(id), { openBubble: true, fly: true })
    message.value = '已加载空间预览并在底图定位'
  } catch (err) {
    error.value = errMessage(err, '空间预览失败')
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const raw = text.trim()
  if (raw === '') return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(label + ' 必须是 JSON 对象')
    }
    return value as Record<string, unknown>
  } catch (err) {
    throw new Error(label + ' JSON 无效：' + (err instanceof Error ? err.message : String(err)))
  }
}

async function createSource() {
  if (sourceForm.value.code === '' || sourceForm.value.name === '' || sourceForm.value.endpointAddress === '') {
    error.value = '请填写编码、名称、协议端点'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    const connectionParameters = parseJsonObject(sourceForm.value.connectionParametersText, '连接参数')
    const fieldMapping = parseJsonObject(sourceForm.value.fieldMappingText, '字段映射')
    const ingestionStrategy = parseJsonObject(sourceForm.value.ingestionStrategyText, '接入策略')
    const body: Record<string, unknown> = {
      code: sourceForm.value.code,
      name: sourceForm.value.name,
      protocol: sourceForm.value.protocol,
      endpointAddress: sourceForm.value.endpointAddress,
      authMethod: sourceForm.value.authMethod,
      credentialReference: sourceForm.value.credentialReference,
      connectionParameters,
      fieldMapping,
      ingestionStrategy,
    }
    if (sourceForm.value.platformId) body.platformId = Number(sourceForm.value.platformId)
    else if (editingSourceId.value) body.platformId = null
    if (editingSourceId.value) await api.updateDataSource(editingSourceId.value, body)
    else await api.createDataSource(body)
    message.value = editingSourceId.value ? '数据源修改已保存' : '协议数据源已登记（默认可测试/启用后实时拉取）'
    editingSourceId.value = ''
    sourceForm.value.code = ''
    sourceForm.value.name = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '登记失败')
  } finally {
    pending.value = false
  }
}

async function loadSourceAudits(sourceId?: string) {
  const id = sourceId || selectedAuditSourceId.value
  if (!id) {
    sourceAudits.value = []
    return
  }
  selectedAuditSourceId.value = id
  pullForm.value.sourceId = id
  try {
    const res = await api.listDataSourceAudits('?sourceId=' + encodeURIComponent(id))
    sourceAudits.value = res.data
  } catch (err) {
    error.value = errMessage(err, '加载审计失败')
  }
}

async function testSource(id: unknown) {
  clearAlerts()
  try {
    const res = await api.testDataSource(String(id))
    detail.value = res.data
    message.value = '连接测试完成：' + String((res.data as any)?.source?.lastTestMessage || (res.data as any)?.audit?.message || '')
    await load()
    await loadSourceAudits(String(id))
  } catch (err) {
    error.value = errMessage(err, '测试失败')
  }
}

async function enableSource(id: unknown) {
  clearAlerts()
  try {
    await api.enableDataSource(String(id))
    message.value = '数据源已启用，可执行实时拉取'
    await load()
    await loadSourceAudits(String(id))
  } catch (err) {
    error.value = errMessage(err, '启用失败')
  }
}

async function disableSource(id: unknown) {
  clearAlerts()
  try {
    await api.disableDataSource(String(id))
    message.value = '数据源已停用'
    await load()
    await loadSourceAudits(String(id))
  } catch (err) {
    error.value = errMessage(err, '停用失败')
  }
}

async function pullSource() {
  if (pullForm.value.sourceId === '' || pullForm.value.datasetId === '') {
    error.value = '实时拉取请选择已启用的数据源和目标数据集'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    const body: Record<string, unknown> = {
      datasetId: Number(pullForm.value.datasetId),
      dataType: pullForm.value.dataType || 'timeseries',
    }
    if (pullForm.value.dataName) body.dataName = pullForm.value.dataName
    if (pullForm.value.spatialGeoJson) body.spatialGeoJson = pullForm.value.spatialGeoJson
    const res = await api.pullDataSource(pullForm.value.sourceId, body)
    detail.value = res.data
    const count = (res.data as any)?.recordCount
    message.value = '实时拉取成功，写入 ' + String(count ?? 0) + ' 条记录'
    await load()
    await loadSourceAudits(pullForm.value.sourceId)
    try {
      await showDataOnMap()
      const payload = res.data as Record<string, unknown> | null
      const rec = (payload?.record || payload?.data || payload) as Record<string, unknown> | null
      const dataId =
        rec?.observationDataId ??
        rec?.dataId ??
        rec?.id ??
        payload?.observationDataId ??
        payload?.dataId ??
        payload?.id
      if (dataId != null) await selectShellFeature('data', String(dataId), { openBubble: true, fly: true })
    } catch { /* 地图操作为可选步骤 */ }
  } catch (err) {
    error.value = errMessage(err, '实时拉取失败')
  } finally {
    pending.value = false
  }
}

async function refreshLiveStatus(sourceId?: string) {
  const id = sourceId || pullForm.value.sourceId || selectedAuditSourceId.value
  if (!id) {
    liveStatus.value = null
    stopLivePolling()
    lastLivePullCount = null
    return
  }
  try {
    const res = await api.getLiveDataSourceStatus(id)
    liveStatus.value = (res.data as any)?.live || (res.data as any) || null
    const live = (liveStatus.value || {}) as Record<string, unknown>
    const st = String(live.status || '').toLowerCase()
    const pullCount = Number(
      live.pullCount ?? live.totalPulls ?? live.recordCount ?? live.successCount ?? live.recordsWritten ?? NaN,
    )
    if (st === 'running' || st === 'active' || st === 'pulling') {
      if (livePollTimer == null) startLivePolling(String(id))
      // 定时接入有新写入时刷新地图数据层
      if (Number.isFinite(pullCount) && lastLivePullCount != null && pullCount > lastLivePullCount) {
        try {
          await showDataOnMap()
          message.value = `实时接入有新数据（累计 ${pullCount}），地图数据层已刷新`
        } catch { /* 地图操作为可选步骤 */ }
      }
      if (Number.isFinite(pullCount)) lastLivePullCount = pullCount
    } else if (st === 'stopped' || st === 'idle' || st === 'error' || st === 'failed') {
      stopLivePolling()
      if (Number.isFinite(pullCount)) lastLivePullCount = pullCount
    }
  } catch {
    liveStatus.value = null
  }
}

async function startLivePull() {
  if (pullForm.value.sourceId === '' || pullForm.value.datasetId === '') {
    error.value = '请先选择接入通道和目标数据集'
    return
  }
  const src = sources.value.find((s) => String(s.id) === String(pullForm.value.sourceId))
  if (src && String(src.status || '').toLowerCase() !== 'enabled') {
    error.value = '请先启用数据源，再启动定时接入（当前状态：' + sourceStatusLabel(src.status) + '）'
    return
  }
  clearAlerts()
  pending.value = true
  try {
    const body: Record<string, unknown> = {
      datasetId: Number(pullForm.value.datasetId),
      dataType: pullForm.value.dataType || 'timeseries',
      intervalSeconds: Number(liveIntervalSeconds.value) || 60,
    }
    if (pullForm.value.spatialGeoJson) body.spatialGeoJson = pullForm.value.spatialGeoJson
    const res = await api.startLiveDataSource(pullForm.value.sourceId, body)
    liveStatus.value = (res.data as any)?.live || null
    lastLivePullCount = Number((res.data as any)?.live?.pullCount ?? (res.data as any)?.live?.recordCount ?? 0) || 0
    startLivePolling(pullForm.value.sourceId)
    try {
      await showDataOnMap()
      await refreshLiveStatus(pullForm.value.sourceId)
      const lastId = (liveStatus.value as any)?.lastObservationDataId
      if (lastId != null && lastId !== '' && lastId !== '-') {
        await selectShellFeature('data', String(lastId), { openBubble: true, fly: true })
      }
    } catch { /* 地图操作为可选步骤 */ }
    message.value = '实时接入已启动，间隔 ' +
      String((res.data as any)?.live?.intervalSeconds || liveIntervalSeconds.value) +
      ' 秒；地图数据层将随新数据自动刷新'
    await loadSourceAudits(pullForm.value.sourceId)
    await load()
  } catch (err) {
    error.value = errMessage(err, '操作失败')
  } finally {
    pending.value = false
  }
}

async function stopLivePull() {
  if (pullForm.value.sourceId === '') {
    error.value = '请先选择接入通道'
    return
  }
  clearAlerts()
  pending.value = true
  try {
    const res = await api.stopLiveDataSource(pullForm.value.sourceId)
    liveStatus.value = (res.data as any)?.live || null
    stopLivePolling()
    message.value = '实时接入已停止'
    await loadSourceAudits(pullForm.value.sourceId)
  } catch (err) {
    error.value = errMessage(err, '操作失败')
  } finally {
    pending.value = false
  }
}

async function previewSampleFeed() {
  clearAlerts()
  pending.value = true
  try {
    const res = await api.getSampleLiveFeed()
    detail.value = res.data
    message.value = '样例数据流已加载'
  } catch (err) {
    error.value = errMessage(err, '操作失败')
  } finally {
    pending.value = false
  }
}


function selectSourceForOps(id: unknown) {
  selectedAuditSourceId.value = String(id)
  pullForm.value.sourceId = String(id)
  void loadSourceAudits(String(id))
  void refreshLiveStatus(String(id))
}

async function runImport(id: unknown, action: 'execute' | 'pause' | 'resume' | 'retry') {
  clearAlerts()
  try {
    if (action === 'execute') await api.executeFileImport(String(id))
    if (action === 'pause') await api.pauseFileImport(String(id))
    if (action === 'resume') await api.resumeFileImport(String(id))
    if (action === 'retry') await api.retryFileImport(String(id))
    message.value = '导入任务操作完成：' + action
    await load()
  } catch (err) {
    error.value = errMessage(err, '导入任务操作失败')
  }
}

async function onPickFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  importFile.value = input.files && input.files[0] ? input.files[0] : null
}

async function submitImport() {
  if (importFile.value == null) {
    error.value = '请选择要导入的文件（csv/geojson/json）'
    return
  }
  if (importForm.value.datasetId === '' || importForm.value.platformId === '' || importForm.value.dataName === '') {
    error.value = '请选择数据集、平台并填写数据名称'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    const spatialGeoJson =
      importForm.value.spatialGeoJson || platformGeometry(importForm.value.platformId)
    if (!spatialGeoJson) {
      error.value = isSatellitePlatform(importForm.value.platformId)
        ? '请提供遥感影像产品的真实覆盖面'
        : '请先在地图设置导入位置，或为关联平台维护位置'
      return
    }
    if (isSatellitePlatform(importForm.value.platformId) && !isFootprintGeometry(spatialGeoJson)) {
      error.value = '卫星遥感影像覆盖范围必须是 Polygon 或 MultiPolygon'
      return
    }
    const form = new FormData()
    form.append('file', importFile.value)
    form.append('datasetId', importForm.value.datasetId)
    form.append('platformId', importForm.value.platformId)
    if (importForm.value.dataSourceId) form.append('dataSourceId', importForm.value.dataSourceId)
    form.append('dataName', importForm.value.dataName)
    form.append('dataType', importForm.value.dataType)
    form.append('sourceName', importForm.value.sourceName)
    form.append('spatialGeoJson', JSON.stringify(spatialGeoJson))
    form.append('timeStart', isoNow(-7200_000))
    form.append('timeEnd', isoNow())
    form.append('version', String(importForm.value.version || 1))
    form.append('duplicateStrategy', importForm.value.duplicateStrategy)
    form.append('executeNow', importForm.value.executeNow ? 'true' : 'false')
    const res = await api.importObservationFile(form)
    detail.value = res.data
    message.value = '文件导入任务已创建' + (importForm.value.executeNow ? '并已触发执行' : '')
    importForm.value.dataName = ''
    importFile.value = null
    await load()
    await setTab('sources')
  } catch (err) {
    error.value = errMessage(err, '文件导入失败')
  } finally {
    pending.value = false
  }
}

async function downloadTemplate() {
  clearAlerts()
  try {
    const text = await api.downloadImportTemplate('csv')
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'observation-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
    message.value = '模板已下载'
  } catch (err) {
    error.value = errMessage(err, '模板下载失败')
  }
}

async function doExport() {
  clearAlerts()
  try {
    let pathQuery = buildDataQueryString(true)
    pathQuery = pathQuery ? pathQuery + '&exportFormat=csv' : '?exportFormat=csv'
    exportPreview.value = await api.exportObservationDataCsv(pathQuery)
    message.value = '导出完成（CSV，已应用当前筛选条件）'
  } catch (err) {
    error.value = errMessage(err, '导出失败')
  }
}


const vizByType = computed(() => {
  const map = new Map<string, number>()
  for (const row of dataList.value) {
    const key = String(row.dataType || row.type || 'unknown')
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
})
const vizByQuality = computed(() => {
  const map = new Map<string, number>()
  for (const row of dataList.value) {
    const key = String(row.qualityStatus || row.quality || 'unknown')
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
})

onMounted(async () => {
  syncTab()
  await load()
  applyRouteSensorQuery()
  if (tab.value === 'query' && qPlatformId.value) {
    try { await runDataQuery(true) } catch { /* 可选刷新失败不影响主流程 */ }
  }
})
watch(() => route.query.tab, syncTab)
watch(
  () => [route.query.sensorId, route.query.platformId],
  () => {
    applyRouteSensorQuery()
  },
)

function applyRouteSensorQuery() {
  const sid = route.query.sensorId ?? route.query.platformId
  if (sid == null || sid === '') return
  const id = String(Array.isArray(sid) ? sid[0] : sid)
  qPlatformId.value = id
  if (tab.value !== 'query') void setTab('query')
  message.value = '已根据地图跳转筛选平台/传感器 #' + id
}


async function locateOnMap(id: string | number | unknown) {
  setShellVisibility({ showSensors: false, showData: true, showTasks: false })
  const ok = await selectShellFeature('data', String(id), { openBubble: true, fly: true })
  message.value = ok
    ? `已在地图定位监测数据 #${id}`
    : `地图未找到数据 #${id} 的空间位置`
  if (!ok) error.value = message.value
  else error.value = null
}

async function showDataOnMap() {
  refreshTimeExtent()
  await showShellAndFit('data', '/data')
  await setDataLayerStyle('all')
  mapDisplayMode.value = 'all'
  message.value = `已在底图显示监测数据（点+热力聚合，${shellCounts.data} 个要素）`
}

async function showHeatmapOnMap() {
  refreshTimeExtent()
  await showShellAndFit('data', '/data')
  await setDataLayerStyle('heat')
  mapDisplayMode.value = 'heat'
  message.value = `已切换热力聚合上图（${shellCounts.data} 个数据要素的网格聚合）`
}

async function showDataPointsOnMap() {
  refreshTimeExtent()
  await showShellAndFit('data', '/data')
  await setDataLayerStyle('points')
  mapDisplayMode.value = 'points'
  message.value = `已切换采样点上图（${shellCounts.data} 个要素）`
}

async function filterDataQualityOnMap(quality: string = '') {
  const q = String(quality || '').trim()
  error.value = null
  await showShellAndFit('data', '/data')
  await applyShellDataQualityFilter(q)
  mapQualityFilter.value = q
  if (q) {
    message.value = `地图已按质量筛选: ${q} · ${shellCounts.data} 个`
  } else {
    message.value = `已清除质量筛选，显示全部数据 ${shellCounts.data} 个`
  }
}

function editSource(item: Record<string, unknown>) {
  const jsonText = (value: unknown, fallback: string) => value && typeof value === 'object' ? JSON.stringify(value, null, 2) : fallback
  editingSourceId.value = String(item.id)
  sourceForm.value = {
    code: String(item.code || ''),
    name: String(item.name || ''),
    platformId: item.platformId == null ? '' : String(item.platformId),
    protocol: String(item.protocol || 'https'),
    endpointAddress: String(item.endpointAddress || ''),
    authMethod: String(item.authMethod || 'none'),
    credentialReference: String(item.credentialReference || ''),
    connectionParametersText: jsonText(item.connectionParameters, '{}'),
    fieldMappingText: jsonText(item.fieldMapping, '{}'),
    ingestionStrategyText: jsonText(item.ingestionStrategy, '{}'),
  }
  sourcePage.value = 2
  message.value = `正在编辑数据源“${item.name}”，完成基础信息后到下一步保存`
}

function cancelSourceEdit() {
  editingSourceId.value = ''
  sourceForm.value.code = ''
  sourceForm.value.name = ''
}

function editData(item: Record<string, unknown>) {
  editingDataId.value = String(item.id)
  dataForm.value = {
    datasetId: String(item.datasetId || ''),
    platformId: String(item.platformId || ''),
    name: String(item.name || ''),
    dataType: String(item.dataType || 'observation'),
    sourceName: String(item.sourceName || ''),
    dataFormat: String(item.dataFormat || 'json'),
    spatialGeoJson: (item.spatialGeoJson as SimpleGeometry | null) || wktToGeoJson(String(item.spatialWkt || '')),
    version: Number(item.version || 1),
  }
  crudPage.value = 2
  message.value = `正在编辑监测数据“${item.name}”`
}

function cancelDataEdit() {
  editingDataId.value = ''
  dataForm.value.name = ''
  dataForm.value.spatialGeoJson = null
}

function changeMapQualityFilter(event: Event) {
  void filterDataQualityOnMap((event.target as HTMLSelectElement).value)
}


onUnmounted(() => {
  stopTimePlayback()

  stopLivePolling()
})
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">观测数据中心</p>
        <h1>数据建模、多源接入与查询</h1>
        <p class="muted">对应文档：监测数据 CRUD、多源接入、综合查询导出、可视化支撑。</p>
      </div>
    </header>
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>
      <div class="data-map-toolbar" data-testid="data-map-actions" aria-label="地图联动">
        <div class="data-map-toolbar-head">
          <strong>地图联动</strong>
          <RouterLink class="data-map-manage-link" to="/applications?tab=gis">图层管理 <span aria-hidden="true">›</span></RouterLink>
        </div>
        <div class="data-map-control-row">
          <span class="data-map-control-label">展示</span>
          <div class="data-map-segmented" role="group" aria-label="数据展示方式">
            <button type="button" :class="{ active: mapDisplayMode === 'all' }" :aria-pressed="mapDisplayMode === 'all'" :disabled="pending" @click="showDataOnMap">点 + 热力</button>
            <button type="button" :class="{ active: mapDisplayMode === 'heat' }" :aria-pressed="mapDisplayMode === 'heat'" :disabled="pending" @click="showHeatmapOnMap">热力图</button>
            <button type="button" :class="{ active: mapDisplayMode === 'points' }" :aria-pressed="mapDisplayMode === 'points'" :disabled="pending" @click="showDataPointsOnMap">采样点</button>
          </div>
        </div>
        <div class="data-map-filter-row">
          <label class="data-map-quality-select">
            <span class="data-map-control-label">质量</span>
            <select :value="mapQualityFilter" :disabled="pending" @change="changeMapQualityFilter">
              <option value="">全部数据</option>
              <option value="unchecked">未检</option>
              <option value="warning">告警</option>
              <option value="anomaly">异常</option>
            </select>
          </label>
          <button class="data-map-clear" type="button" :disabled="pending || !timeFilterActive" @click="clearTimeFilterOnMap">清除时间筛选</button>
        </div>
        <p class="data-map-status" aria-live="polite"><span aria-hidden="true"></span>{{ shellStatus }}</p>
      </div>

    <section v-if="tab === 'crud'" class="panel">
      <h2>监测数据建模与增删改查</h2>
      <template v-if="crudPage === 1">
      <h3>数据集</h3>
      <div class="form-row">
        <label>编码<input v-model="datasetForm.code" /></label>
        <label>名称<input v-model="datasetForm.name" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createDataset">创建数据集</button>
      </div>
      <p class="muted">已有数据集 {{ datasets.length }} 个</p>
      </template>

      <template v-if="crudPage === 2">
      <h3>{{ editingDataId ? '编辑监测数据' : '新增监测数据' }}</h3>
      <div class="form-row">
        <label>数据集
          <select v-model="dataForm.datasetId">
            <option value="">请选择</option>
            <option v-for="d in datasets" :key="'ds'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name }}</option>
          </select>
        </label>
        <label>平台
          <select v-model="dataForm.platformId">
            <option value="">请选择</option>
            <option v-for="p in platforms" :key="'pl'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
          </select>
        </label>
        <label>名称<input v-model="dataForm.name" /></label>
        <label>类型<input v-model="dataForm.dataType" /></label>
        <label>格式<input v-model="dataForm.dataFormat" /></label>
        <label>来源<input v-model="dataForm.sourceName" /></label>
        <div class="spatial-pick" :class="{ ready: dataForm.spatialGeoJson || platformGeometry(dataForm.platformId) }">
          <span>{{ dataForm.spatialGeoJson ? (isSatellitePlatform(dataForm.platformId) ? '影像覆盖范围已设置' : '数据空间位置已设置') : (isSatellitePlatform(dataForm.platformId) ? '需提供真实影像覆盖范围' : '默认采用关联平台位置') }}</span>
          <button class="btn ghost" type="button" @click="applyMapDrawSpatial('data')">{{ isSatellitePlatform(dataForm.platformId) ? '采用地图绘制覆盖面' : '采用地图位置' }}</button>
        </div>
        <div class="form-actions"><button class="btn" type="button" :disabled="pending" @click="createData">{{ editingDataId ? '保存修改' : '新增监测数据' }}</button><button v-if="editingDataId" class="btn ghost" type="button" @click="cancelDataEdit">取消编辑</button></div>
      </div>
      </template>
      <template v-if="crudPage === 3">
      <h3>监测数据列表</h3>
      <table v-table-pager="{ label: '监测数据分页' }" class="table">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>平台</th><th>质量</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="!dataList.length"><td colspan="8" class="muted">暂无监测数据，可通过建模新增或接入通道拉取</td></tr>
          <tr v-for="d in dataList" :key="String(d.id)" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'data' && shellSelected.id === String(d.id) }" @click="locateOnMap(String(d.id))">
            <td>{{ d.id }}</td>
            <td>{{ d.name }}</td>
            <td>{{ d.dataType }}</td>
            <td>{{ d.platformId }}</td>
            <td>{{ d.qualityStatus || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="locateOnMap(String(d.id))">定位</button>
              <button class="btn ghost" type="button" @click.stop="editData(d)">编辑</button>
              <button class="btn ghost" type="button" @click="runQuality(d.id)">质检</button>
              <button class="btn ghost" type="button" @click="doQuarantine(d.id)">隔离</button>
              <button class="btn ghost" type="button" @click="doRelease(d.id)">放行</button>
              <button class="btn ghost" type="button" @click="showProvenance(d.id)">溯源</button>
              <button class="btn ghost" type="button" @click="showSpatial(d.id)">空间</button>
              <button class="btn ghost" type="button" @click.stop="removeData(d.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <pre v-if="detail" class="result-pre">{{ JSON.stringify(detail, null, 2).slice(0, 3000) }}</pre>
      </template>
      <CardPager v-model:page="crudPage" :pages="crudPages" label="监测数据维护内容分页" />
    </section>

    <section v-if="tab === 'sources'" class="panel">
      <h2>多源协议数据接入工作台</h2>
      <template v-if="sourcePage === 1">
      <p class="muted">
        <strong>多源接入 = 把别人系统的协议数据持续接入本系统</strong>（活通道），不是简单文件导入。
        主路径：登记外部协议端点 → 测试连接 → 启用 → 立即拉取 / 定时接入 → 审计溯源。
      </p>
      <p class="muted">
        第一阶段约定样例通道：端点填 <code>internal://sample-live-feed</code>（或点“预览样例通道”）。
        HTTP/HTTPS/sample 已实现实时拉取与定时接入；MQTT/Kafka/DB 可登记但未实现执行器，不得伪装为已实时。
        文件导入仅用于离线补录，在页面底部次要区域。
      </p>
      <div class="form-row">
        <button class="btn ghost" type="button" :disabled="pending" @click="previewSampleFeed">预览约定样例通道</button>
      </div>
      </template>

      <template v-if="sourcePage === 2">
      <h3>2. {{ editingSourceId ? '编辑数据源基础信息' : '数据源基础信息' }}</h3>
      <div class="form-row source-basic-grid">
        <label>编码<input v-model="sourceForm.code" placeholder="LIVE-HTTP-001" /></label>
        <label>名称<input v-model="sourceForm.name" placeholder="市气象局实时接口" /></label>
        <label>绑定平台
          <select v-model="sourceForm.platformId">
            <option value="">请选择（拉取时需要）</option>
            <option v-for="p in platforms" :key="'spl'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
          </select>
        </label>
        <label>协议
          <select v-model="sourceForm.protocol">
            <option value="https">https</option>
            <option value="http">http</option>
            <option value="sample">sample（内置约定样例通道）</option>
            <option value="mqtt">mqtt（可登记，拉取执行器待扩展）</option>
            <option value="kafka">kafka（可登记，拉取执行器待扩展）</option>
            <option value="db">db（可登记，拉取执行器待扩展）</option>
          </select>
        </label>
        <label class="wide">端点地址<input v-model="sourceForm.endpointAddress" /></label>
      </div>
      </template>
      <template v-if="sourcePage === 3">
      <h3>3. 鉴权与接入参数</h3>
      <div class="form-row">
        <label>鉴权
          <select v-model="sourceForm.authMethod">
            <option value="none">none</option>
            <option value="bearer">bearer</option>
            <option value="basic">basic</option>
          </select>
        </label>
        <label>凭据引用<input v-model="sourceForm.credentialReference" placeholder="env:OBS_TOKEN（禁止写明文）" /></label>
      </div>
      <details class="source-advanced-config">
        <summary>高级连接、字段映射与接入策略</summary>
        <div class="form-row source-json-grid">
          <label class="wide">连接参数 JSON<textarea v-model="sourceForm.connectionParametersText" rows="3"></textarea></label>
          <label class="wide">字段映射 JSON<textarea v-model="sourceForm.fieldMappingText" rows="3"></textarea></label>
          <label class="wide">接入策略 JSON<textarea v-model="sourceForm.ingestionStrategyText" rows="2"></textarea></label>
        </div>
      </details>
      <div class="source-primary-action">
        <button class="btn" type="button" :disabled="pending" @click="createSource">{{ editingSourceId ? '保存数据源修改' : '登记协议数据源' }}</button>
        <button v-if="editingSourceId" class="btn ghost" type="button" @click="cancelSourceEdit">取消编辑</button>
      </div>
      </template>

      <template v-if="sourcePage === 4">
      <h3>4. 数据源生命周期</h3>
      <table v-table-pager="{ label: '数据源分页' }" class="table">
        <thead>
          <tr>
            <th>ID</th><th>编码</th><th>名称</th><th>协议</th><th>平台</th><th>状态</th>
            <th>最近测试</th><th>测试说明</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!sources.length"><td colspan="8" class="muted">暂无接入通道，请先登记协议数据源</td></tr>
          <tr v-for="s in sources" :key="String(s.id)" :class="{ active: String(s.id) === selectedAuditSourceId }">
            <td>{{ s.id }}</td>
            <td>{{ s.code }}</td>
            <td>{{ s.name }}</td>
            <td>{{ s.protocol }}</td>
            <td>{{ s.platformName || s.platformId || '-' }}</td>
            <td><span class="status-pill" :data-status="String(s.status||'')">{{ sourceStatusLabel(s.status) }}</span></td>
            <td>{{ s.lastTestStatus || '-' }}</td>
            <td class="clamp">{{ s.lastTestMessage || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click="selectSourceForOps(s.id)">选中</button>
              <button class="btn ghost" type="button" @click="editSource(s)">编辑</button>
              <button class="btn ghost" type="button" @click="testSource(s.id)">测试连接</button>
              <button class="btn ghost" type="button" @click.stop="enableSource(s.id)">启用</button>
              <button class="btn ghost" type="button" @click.stop="disableSource(s.id)">停用</button>
            </td>
          </tr>
        </tbody>
      </table>
      </template>

      <template v-if="sourcePage === 5">
      <h3>5. 即时拉取</h3>
      <div class="form-row source-pull-grid">
        <label>数据源
          <select v-model="pullForm.sourceId" @change="loadSourceAudits(pullForm.sourceId); refreshLiveStatus(pullForm.sourceId)">
            <option value="">请选择已启用源</option>
            <option v-for="s in sources" :key="'ps'+s.id" :value="String(s.id)">
              #{{ s.id }} {{ s.code }} [{{ s.status }}]
            </option>
          </select>
        </label>
        <label>写入数据集
          <select v-model="pullForm.datasetId">
            <option value="">请选择</option>
            <option v-for="d in datasets" :key="'pds'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name }}</option>
          </select>
        </label>
        <label class="wide">数据名称（仅单次拉取）<input v-model="pullForm.dataName" placeholder="可空，默认源码+时间戳" /></label>
        <label>类型<input v-model="pullForm.dataType" /></label>
        <div class="spatial-pick wide" :class="{ ready: pullForm.spatialGeoJson }">
          <span>{{ pullForm.spatialGeoJson ? '接入范围已设置' : '默认采用平台位置' }}</span>
        </div>
        <div class="source-form-actions">
          <button class="btn" type="button" :disabled="pending" @click="pullSource">立即拉取一次</button>
          <button class="btn ghost" type="button" @click="applyMapDrawSpatial('live')">采用地图范围</button>
        </div>
      </div>
      <p class="muted">单次拉取会写入观测数据，来源追溯 <code>source:数据源编码</code>。</p>
      </template>
      <template v-if="sourcePage === 6">
      <h3>6. 定时接入</h3>
      <div class="form-row">
        <label>定时间隔秒<input v-model.number="liveIntervalSeconds" type="number" min="5" step="5" /></label>
        <button class="btn" type="button" :disabled="pending" @click="startLivePull">启动定时接入</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="stopLivePull">停止定时接入</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="refreshLiveStatus()">刷新接入状态</button>
      </div>
      <p class="muted">
        定时接入按间隔反复从外部协议端点拉数，属于“活接入”；停用数据源会自动停止定时任务。
      </p>
      </template>
      <template v-if="sourcePage === 7">
      <h3>7. 实时接入状态</h3>
      <div v-if="liveStatus" class="live-status-card" :class="{ running: String(liveStatus.status || '').toLowerCase() === 'running' || String(liveStatus.status || '').toLowerCase() === 'active' || String(liveStatus.status || '').toLowerCase() === 'pulling' }">
        <div class="live-status-head">
          <span :class="liveStatusClass(liveStatus.status)"></span>
          <strong>{{ liveStatusLabel(liveStatus.status) }}</strong>
          <span class="muted">源 #{{ liveStatus.sourceId || pullForm.sourceId }} · 间隔 {{ liveStatus.intervalSeconds || '-' }}s</span>
        </div>
        <div class="ops" style="margin:0.4rem 0 0.2rem">
          <button class="btn ghost tiny" type="button" @click="locateLatestLiveOnMap">定位最近观测到地图</button>
          <button class="btn ghost tiny" type="button" :disabled="pending" @click="showDataOnMap">刷新数据图层</button>
        </div>
        <div class="live-status-grid">
          <div><span class="muted">拉取次数</span><strong>{{ liveStatus.pullCount ?? 0 }}</strong></div>
          <div><span class="muted">成功</span><strong>{{ liveStatus.successCount ?? 0 }}</strong></div>
          <div><span class="muted">失败</span><strong>{{ liveStatus.failureCount ?? 0 }}</strong></div>
          <div><span class="muted">最近观测</span><strong>{{ liveStatus.lastObservationDataId || '-' }}</strong></div>
          <div class="wide"><span class="muted">最近拉取</span><strong>{{ liveStatus.lastPullAt || '-' }}</strong></div>
          <div class="wide" v-if="liveStatus.lastError"><span class="muted">错误</span><strong class="error">{{ liveStatus.lastError }}</strong></div>
        </div>
      </div>
      <p v-else class="muted">选择数据源并刷新接入状态后，可在这里查看拉取次数、成功率和最近观测。</p>
      </template>

      <template v-if="sourcePage === 8">
      <h3>8. 接入审计 / 失败提示</h3>
      <div class="form-row">
        <label>查看数据源
          <select v-model="selectedAuditSourceId" @change="loadSourceAudits()">
            <option value="">全部已选为空</option>
            <option v-for="s in sources" :key="'as'+s.id" :value="String(s.id)">#{{ s.id }} {{ s.code }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="loadSourceAudits()">刷新审计</button>
      </div>
      <table v-if="sourceAudits.length" v-table-pager="{ label: '接入审计分页' }" class="table">
        <thead><tr><th>ID</th><th>动作</th><th>结果</th><th>说明</th><th>HTTP</th><th>耗时ms</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-if="!sourceAudits.length"><td colspan="6" class="muted">暂无接入审计，请选择通道并测试/拉取</td></tr>
          <tr v-for="a in sourceAudits" :key="'a'+a.id">
            <td>{{ a.id }}</td>
            <td>{{ a.action }}</td>
            <td>{{ a.resultStatus }}</td>
            <td class="clamp">{{ a.message }}</td>
            <td>{{ a.httpStatusCode ?? '-' }}</td>
            <td>{{ a.durationMs ?? '-' }}</td>
            <td>{{ a.createdAt }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted" v-else>暂无审计记录。对数据源执行测试/启用/拉取后会出现。</p>
      </template>

      <template v-if="sourcePage === 9">
      <h3>9. 文件与关联信息</h3>
      <p class="muted">仅用于本地样例文件或离线补录，不替代协议实时接入。</p>
      <div class="form-row source-file-grid">
        <label class="wide">数据文件<input type="file" accept=".csv,.json,.geojson,.txt" @change="onPickFile" /></label>
        <label>数据集
          <select v-model="importForm.datasetId">
            <option value="">请选择</option>
            <option v-for="d in datasets" :key="'ids'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name }}</option>
          </select>
        </label>
        <label>平台
          <select v-model="importForm.platformId">
            <option value="">请选择</option>
            <option v-for="p in platforms" :key="'ipl'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
          </select>
        </label>
        <label>关联数据源(可选)
          <select v-model="importForm.dataSourceId">
            <option value="">无</option>
            <option v-for="s in sources" :key="'is'+s.id" :value="String(s.id)">#{{ s.id }} {{ s.code }}</option>
          </select>
        </label>
        <label>数据名称<input v-model="importForm.dataName" /></label>
        <label>类型<input v-model="importForm.dataType" /></label>
      </div>
      </template>
      <template v-if="sourcePage === 10">
      <h3>10. 导入设置</h3>
      <div class="form-row">
        <div class="spatial-pick" :class="{ ready: importForm.spatialGeoJson || platformGeometry(importForm.platformId) }">
          <span>{{ importForm.spatialGeoJson ? (isSatellitePlatform(importForm.platformId) ? '影像覆盖范围已设置' : '导入空间位置已设置') : (isSatellitePlatform(importForm.platformId) ? '需从产品元数据或地图提供覆盖面' : '导入后默认采用平台位置') }}</span>
          <button class="btn ghost" type="button" @click="applyMapDrawSpatial('import')">{{ isSatellitePlatform(importForm.platformId) ? '采用地图绘制覆盖面' : '采用地图位置' }}</button>
        </div>
        <label>重复策略
          <select v-model="importForm.duplicateStrategy">
            <option value="reject">reject</option>
            <option value="skip">skip</option>
            <option value="replace">replace</option>
          </select>
        </label>
        <label class="check"><input v-model="importForm.executeNow" type="checkbox" /> 上传后立即执行</label>
        <button class="btn" type="button" :disabled="pending" @click="submitImport">上传并导入</button>
        <button class="btn ghost" type="button" @click="downloadTemplate">下载 CSV 模板</button>
      </div>
      </template>
      <template v-if="sourcePage === 11">
      <h3>11. 文件导入任务</h3>
      <p class="muted" v-if="imports.length === 0">暂无导入任务。</p>
      <table v-else v-table-pager="{ label: '文件导入任务分页' }" class="table">
        <thead><tr><th>ID</th><th>文件</th><th>状态</th><th>进度</th><th>成功/失败</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="!imports.length"><td colspan="7" class="muted">暂无文件导入任务</td></tr>
          <tr v-for="f in imports" :key="'f'+f.id">
            <td>{{ f.id }}</td>
            <td>{{ f.originalFileName || f.name || f.code || '-' }}</td>
            <td>{{ f.status }}</td>
            <td>{{ f.progress ?? '-' }}</td>
            <td>{{ f.successCount ?? 0 }}/{{ f.failureCount ?? 0 }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" :disabled="canByStatus(f.status, ['pending', 'paused', 'failed']) === false" @click="runImport(f.id, 'execute')">执行</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(f.status, ['running']) === false" @click="runImport(f.id, 'pause')">暂停</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(f.status, ['paused']) === false" @click="runImport(f.id, 'resume')">恢复</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(f.status, ['failed']) === false" @click="runImport(f.id, 'retry')">重试</button>
            </td>
          </tr>
        </tbody>
      </table>
      </template>
      <CardPager v-model:page="sourcePage" :pages="sourcePages" previous-label="上一步" next-label="下一步" label="数据接入步骤分页" />
    </section>

    <section v-if="tab === 'query'" class="panel">
      <h2>监测数据综合查询与导出</h2>
      <p class="muted">支持按关键字、类型、质量、数据集、平台组合查询；导出使用同一套筛选条件。</p>
      <template v-if="queryViewPage === 1">
      <div class="form-row data-query-grid">
        <label class="wide">关键字<input v-model="q" placeholder="名称/来源/平台" /></label>
        <label>类型<input v-model="qType" placeholder="observation / timeseries" /></label>
        <label>质量状态<input v-model="qQuality" placeholder="passed/failed/unchecked" /></label>
        <label>数据集
          <select v-model="qDatasetId">
            <option value="">全部</option>
            <option v-for="d in datasets" :key="'qd'+d.id" :value="String(d.id)">#{{ d.id }} {{ d.name }}</option>
          </select>
        </label>
        <label>平台
          <select v-model="qPlatformId">
            <option value="">全部</option>
            <option v-for="p in platforms" :key="'qp'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
          </select>
        </label>
        <label>每页
          <select v-model.number="queryPageSize" @change="runDataQuery(true)">
            <option :value="4">4</option>
            <option :value="8">8</option>
            <option :value="12">12</option>
          </select>
        </label>
        <div class="data-query-actions">
          <button class="btn" type="button" :disabled="pending" @click="runDataQuery(true)">查询</button>
          <button class="btn ghost" type="button" @click="doExport">导出 CSV</button>
          <button class="btn ghost" type="button" @click="resetDataQuery">重置</button>
        </div>
      </div>
      </template>
      <template v-if="queryViewPage === 2">
      <p class="muted">
        显示 {{ filtered.length }} 条
        · 服务端本页 {{ queryServerHits.length }} / 总计 {{ queryTotal }}
      </p>
      <div class="table-region">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>质量</th><th>时间</th><th>空间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-if="!displayedData.length"><td colspan="7" class="muted">无查询结果</td></tr>
              <tr v-for="d in displayedData" :key="'q'+d.id" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'data' && shellSelected.id === String(d.id) }" @click="locateOnMap(String(d.id))">
                <td>{{ d.id }}</td>
                <td>{{ d.name }}</td>
                <td>{{ d.dataType }}</td>
                <td>{{ d.qualityStatus || '-' }}</td>
                <td>{{ d.timeStart }} ~ {{ d.timeEnd }}</td>
                <td>{{ d.spatialGeoJson || d.spatialWkt ? '已定位' : '未定位' }}</td>
                <td class="ops">
                  <button class="btn ghost" type="button" @click.stop="locateOnMap(String(d.id))">定位</button>
                  <button class="btn ghost" type="button" @click.stop="showDataOnMap">数据上图</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <CardPager :page="queryPage" kind="records" :pages="dataQueryPageLabels" :summary="`共 ${dataQueryCount} 条`" label="监测数据查询分页" @update:page="setDataPage" />
      </div>
      <pre v-if="exportPreview" class="result-pre">{{ exportPreview.slice(0, 3000) }}</pre>
      </template>
      <CardPager v-model:page="queryViewPage" :pages="queryViewPages" label="监测数据查询内容分页" />
    </section>

    <section v-if="tab === 'viz'" class="panel">
      <h2>监测数据可视化</h2>
      <p class="muted">空间分布请打开 GIS 工作台的数据图层；中心内提供类型/质量分布快览，详细统计在综合应用中心。</p>
      <template v-if="vizPage === 1">
      <div class="form-row" style="margin:0.5rem 0">
        <button class="btn" type="button" :disabled="pending" @click="showDataOnMap">数据上图</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="filterDataQualityOnMap('unchecked')">仅未检</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="filterDataQualityOnMap('warning')">仅告警</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="filterDataQualityOnMap('anomaly')">仅异常</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="filterDataQualityOnMap()">全部数据</button>
      </div>
      <div class="timeline-panel">
        <h3>时间轴过滤（联动底图数据图层）</h3>
        <p class="muted">拖动时间游标或播放，仅显示窗口内的监测数据；无时间字段的数据仍保留显示。</p>
        <div class="form-row">
          <label class="wide">时间游标
            <input
              type="range"
              :min="timeMin || 0"
              :max="timeMax || 0"
              :step="Math.max(60000, Math.floor(((timeMax || 1) - (timeMin || 0)) / 100) || 3600000)"
              v-model.number="timeCursor"
              :disabled="!timeMax"
              @change="applyTimeFilterOnMap"
            />
          </label>
          <label>窗口（小时）<input v-model.number="timeWindowHours" type="number" min="1" step="1" /></label>
          <button class="btn" type="button" :disabled="!timeMax || pending" @click="applyTimeFilterOnMap">应用时间窗</button>
          <button class="btn ghost" type="button" :disabled="!timeMax || shellLoading" @click="toggleTimePlayback">{{ timePlaying ? '暂停播放' : '播放时间轴' }}</button>
          <button class="btn ghost" type="button" @click="clearTimeFilterOnMap">清除时间过滤</button>
        </div>
        <p class="muted">
          范围：{{ formatTimeLabel(timeMin) }} ~ {{ formatTimeLabel(timeMax) }}
          · 当前：{{ formatTimeLabel(timeCursor) }}
          · {{ timeFilterActive ? '过滤已启用' : '未启用过滤' }}
        </p>
      </div>
      </template>
      <template v-if="vizPage === 2">
      <div class="cards">
        <div class="card stat"><h3>监测数据</h3><p class="stat-num">{{ dataList.length }}</p></div>
        <div class="card stat"><h3>数据集</h3><p class="stat-num">{{ datasets.length }}</p></div>
        <div class="card stat"><h3>数据源</h3><p class="stat-num">{{ sources.length }}</p></div>
      </div>
      <div style="margin-top:1rem">
        <div>
          <h3>按数据类型分布</h3>
          <table v-table-pager="{ label: '数据类型统计分页' }" class="table">
            <thead><tr><th>类型</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!vizByType.length"><td colspan="2" class="muted">暂无类型分布</td></tr>
              <tr v-for="row in vizByType" :key="'vt'+row.name"><td>{{ row.name }}</td><td>{{ row.count }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      </template>
      <template v-if="vizPage === 3">
      <div style="margin-top:1rem">
        <div>
          <h3>按质量状态分布</h3>
          <table v-table-pager="{ label: '质量状态统计分页' }" class="table">
            <thead><tr><th>质量状态</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!vizByQuality.length"><td colspan="2" class="muted">暂无质量分布</td></tr>
              <tr v-for="row in vizByQuality" :key="'vq'+row.name" class="row-click" @click="filterDataQualityOnMap(String(row.name))"><td>{{ row.name }}</td><td>{{ row.count }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="form-row" style="margin-top:1rem">
        <button class="btn" type="button" :disabled="pending" @click="showDataOnMap">底图上图</button>
        <RouterLink class="btn ghost" to="/applications?tab=gis">图层控制</RouterLink>
        <RouterLink class="btn ghost" to="/applications?tab=stats">数据统计</RouterLink>
      </div>
      </template>
      <CardPager v-model:page="vizPage" :pages="vizPages" label="监测数据可视化内容分页" />
    </section>
  </section>
</template>

<style scoped>
.data-map-toolbar {
  display: grid;
  gap: 10px;
  margin: 0.45rem 0 0.75rem;
  padding: 11px 12px 10px;
  border: 1px solid #e3e3e8;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(29, 29, 31, 0.035);
}
.data-map-toolbar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.data-map-toolbar-head strong {
  color: #1d1d1f;
  font-size: 12px;
  line-height: 1.3;
}
.data-map-manage-link {
  color: #515154;
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
}
.data-map-manage-link:hover { color: #0071e3; }
.data-map-control-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.data-map-control-label {
  color: #6e6e73;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}
.data-map-segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: #f3f3f5;
}
.data-map-segmented button {
  min-width: 0;
  min-height: 29px;
  padding: 0 5px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #515154;
  font: 500 10px/1.2 inherit;
  cursor: pointer;
  white-space: nowrap;
}
.data-map-segmented button.active {
  background: #fff;
  color: #0066cc;
  box-shadow: 0 0 0 1px rgba(0, 113, 227, 0.18), 0 1px 2px rgba(29, 29, 31, 0.06);
}
.data-map-filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.data-map-quality-select {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.data-map-quality-select select {
  width: 100%;
  height: 31px;
  padding: 0 26px 0 9px;
  border: 1px solid #d2d2d7;
  border-radius: 8px;
  background: #fff;
  color: #3a3a3c;
  font-size: 10px;
}
.data-map-clear {
  min-height: 31px;
  padding: 0 3px;
  border: 0;
  background: transparent;
  color: #515154;
  font: 500 10px/1.2 inherit;
  cursor: pointer;
  white-space: nowrap;
}
.data-map-clear:hover:not(:disabled) { color: #0066cc; }
.data-map-status {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid #ededf0;
  color: #6e6e73;
  font-size: 10px;
  line-height: 1.4;
}
.data-map-status > span {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-top: 4px;
  border-radius: 50%;
  background: #34a853;
}
.data-map-toolbar :is(button, select, a):focus-visible {
  outline: 3px solid rgba(0, 113, 227, 0.18);
  outline-offset: 1px;
}
.data-map-toolbar button:disabled {
  color: #aeaeb2;
  cursor: not-allowed;
}
.data-query-grid.form-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.data-query-grid .wide,
.data-query-actions { grid-column: 1 / -1; }
.data-query-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.data-query-actions .btn {
  min-height: 32px;
  padding: 0.35rem 0.65rem;
  font-size: 10px;
}
.source-basic-grid.form-row,
.source-pull-grid.form-row,
.source-file-grid.form-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.source-advanced-config {
  margin: .65rem 0;
  border: 1px solid #e1e3e6;
  border-radius: 10px;
  background: #f6f7f8;
}
.source-advanced-config summary {
  padding: .6rem .65rem;
  color: #515154;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.source-advanced-config[open] summary { border-bottom: 1px solid #e1e3e6; }
.source-json-grid { margin: 0; padding: .65rem; }
.source-primary-action,
.source-form-actions,
.form-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.source-primary-action { margin-top: .65rem; }
.source-form-actions { grid-column: 1 / -1; }
.source-primary-action .btn,
.source-form-actions .btn { min-height: 32px; padding: .35rem .65rem; font-size: 10px; }
</style>
