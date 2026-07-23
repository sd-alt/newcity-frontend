<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
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
  patchShellFilters,
} from '../gis/mapShell'
import { mapDrawGeometry } from '../gis/mapTools'
import { canByStatus, errMessage, isoNow, pickId } from '../utils/errors'

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
const queryPageSize = ref(20)
const queryTotal = ref(0)

const datasetForm = ref({ code: '', name: '' })
const dataForm = ref({
  datasetId: '',
  platformId: '',
  name: '',
  dataType: 'observation',
  sourceName: 'demo-source',
  dataFormat: 'json',
  spatialWkt: 'POINT(114.1 22.6)',
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
  spatialWkt: '',
})
const sourceAudits = ref<Record<string, unknown>[]>([])
const selectedAuditSourceId = ref('')
const liveStatus = ref<Record<string, unknown> | null>(null)
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
  spatialWkt: 'POINT(114.1 22.6)',
  version: 1,
  duplicateStrategy: 'reject',
  executeNow: true,
})
const importFile = ref<File | null>(null)

const tabs = [
  { key: 'crud', label: '监测数据增删改查' },
  { key: 'sources', label: '多源数据接入' },
  { key: 'query', label: '综合查询导出' },
  { key: 'viz', label: '数据可视化' },
]

const filtered = computed(() => {
  const base = queryServerHits.value.length ? queryServerHits.value : dataList.value
  return base.filter((d) => {
    const okQ = q.value === '' || JSON.stringify(d).includes(q.value)
    const okType = qType.value === '' || String(d.dataType || '') === qType.value
    const okQlt = qQuality.value === '' || String(d.qualityStatus || '') === qQuality.value
    const okDs = qDatasetId.value === '' || String(d.datasetId || '') === qDatasetId.value
    const okPl = qPlatformId.value === '' || String(d.platformId || '') === qPlatformId.value
    return okQ && okType && okQlt && okDs && okPl
  })
})

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

async function changeDataPage(delta: number) {
  const maxPage = Math.max(1, Math.ceil(queryTotal.value / queryPageSize.value) || 1)
  const next = Math.min(maxPage, Math.max(1, queryPage.value + delta))
  if (next === queryPage.value) return
  queryPage.value = next
  await runDataQuery(false)
}

function clearAlerts() {
  error.value = null
  message.value = null
}

async function setTab(key: string) {
  tab.value = key
  await router.replace({ path: '/data', query: { tab: key } })
}
function syncTab() {
  const t = route.query.tab
  if (typeof t === 'string' && tabs.some((x) => x.key === t)) tab.value = t
}


function applyMapDrawSpatial(target: 'live' | 'pull' = 'live') {
  const g = mapDrawGeometry.value
  if (!g || !g.wkt) {
    error.value = '请先用地图工具绘点/绘面，再写入接入空间条件'
    return
  }
  let wkt = g.wkt
  if (g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const delta = 0.08
    wkt = `POLYGON((${lon - delta} ${lat - delta},${lon + delta} ${lat - delta},${lon + delta} ${lat + delta},${lon - delta} ${lat + delta},${lon - delta} ${lat - delta}))`
  }
  pullForm.value.spatialWkt = wkt
  message.value = '已将地图绘制范围写入接入空间条件'
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
    if (selectedAuditSourceId.value === '' && sources.value[0]) {
      selectedAuditSourceId.value = pickId(sources.value[0])
      pullForm.value.sourceId = selectedAuditSourceId.value
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
    try { await reloadShellLayers('/data', {}) } catch { /* map refresh optional */ }
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
    await api.createObservationData({
      datasetId: Number(dataForm.value.datasetId),
      platformId: Number(dataForm.value.platformId),
      name: dataForm.value.name,
      dataType: dataForm.value.dataType,
      sourceName: dataForm.value.sourceName,
      dataFormat: dataForm.value.dataFormat,
      spatialWkt: dataForm.value.spatialWkt,
      timeStart: isoNow(-7200_000),
      timeEnd: isoNow(),
      version: Number(dataForm.value.version) || 1,
    })
    message.value = '监测数据已创建'
    try { await reloadShellLayers('/data', {}) } catch { /* map refresh optional */ }
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
    try { await reloadShellLayers('/data', {}) } catch { /* map refresh optional */ }
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
    await api.createDataSource(body)
    message.value = '协议数据源已登记（默认可测试/启用后实时拉取）'
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
    if (pullForm.value.spatialWkt) body.spatialWkt = pullForm.value.spatialWkt
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
      const dataId = rec?.dataId ?? rec?.id ?? payload?.dataId ?? payload?.id
      if (dataId != null) await selectShellFeature('data', String(dataId), { openBubble: true, fly: true })
    } catch { /* map optional */ }
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
    return
  }
  try {
    const res = await api.getLiveDataSourceStatus(id)
    liveStatus.value = (res.data as any)?.live || (res.data as any) || null
    const st = String((liveStatus.value as any)?.status || '').toLowerCase()
    if (st === 'running' || st === 'active' || st === 'pulling') {
      if (livePollTimer == null) startLivePolling(String(id))
    } else if (st === 'stopped' || st === 'idle' || st === 'error' || st === 'failed') {
      stopLivePolling()
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
    if (pullForm.value.spatialWkt) body.spatialWkt = pullForm.value.spatialWkt
    const res = await api.startLiveDataSource(pullForm.value.sourceId, body)
    liveStatus.value = (res.data as any)?.live || null
    startLivePolling(pullForm.value.sourceId)
    try { await showDataOnMap() } catch { /* map optional */ }
    message.value = '实时接入已启动，间隔 ' +
      String((res.data as any)?.live?.intervalSeconds || liveIntervalSeconds.value) +
      ' 秒'
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
    const form = new FormData()
    form.append('file', importFile.value)
    form.append('datasetId', importForm.value.datasetId)
    form.append('platformId', importForm.value.platformId)
    if (importForm.value.dataSourceId) form.append('dataSourceId', importForm.value.dataSourceId)
    form.append('dataName', importForm.value.dataName)
    form.append('dataType', importForm.value.dataType)
    form.append('sourceName', importForm.value.sourceName)
    form.append('spatialWkt', importForm.value.spatialWkt)
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
})
watch(() => route.query.tab, syncTab)


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
  message.value = `已在底图显示监测数据图层（${shellCounts.data} 个要素）`
}

async function filterDataQualityOnMap(quality: string) {
  await showShellAndFit('data', '/data')
  await applyShellDataQualityFilter(quality)
  message.value = quality
    ? `地图已按质量筛选: ${quality} · ${shellCounts.data} 个`
    : `已清除质量筛选，显示全部数据 ${shellCounts.data} 个`
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
      <RouterLink class="btn ghost" to="/applications?tab=gis">GIS 数据图层</RouterLink>
    </header>
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <section v-if="tab === 'crud'" class="panel">
      <h2>监测数据建模与增删改查</h2>
      <h3>1) 数据集</h3>
      <div class="form-row">
        <label>编码<input v-model="datasetForm.code" /></label>
        <label>名称<input v-model="datasetForm.name" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createDataset">创建数据集</button>
      </div>
      <p class="muted">已有数据集 {{ datasets.length }} 个</p>

      <h3>2) 监测数据</h3>
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
        <label>空间WKT<input v-model="dataForm.spatialWkt" /></label>
        <button class="btn" type="button" :disabled="pending" @click="createData">新增监测数据</button>
      </div>
      <table class="table">
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
    </section>

    <section v-if="tab === 'sources'" class="panel">
      <h2>多源协议数据接入工作台</h2>
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

      <h3>1. 登记协议数据源</h3>
      <div class="form-row">
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
        <label>端点地址<input v-model="sourceForm.endpointAddress" style="min-width:22rem" /></label>
        <label>鉴权
          <select v-model="sourceForm.authMethod">
            <option value="none">none</option>
            <option value="bearer">bearer</option>
            <option value="basic">basic</option>
          </select>
        </label>
        <label>凭据引用<input v-model="sourceForm.credentialReference" placeholder="env:OBS_TOKEN（禁止写明文）" /></label>
      </div>
      <div class="form-row">
        <label class="wide">连接参数 JSON<textarea v-model="sourceForm.connectionParametersText" rows="3"></textarea></label>
        <label class="wide">字段映射 JSON<textarea v-model="sourceForm.fieldMappingText" rows="3"></textarea></label>
        <label class="wide">接入策略 JSON<textarea v-model="sourceForm.ingestionStrategyText" rows="2"></textarea></label>
        <button class="btn" type="button" :disabled="pending" @click="createSource">登记协议数据源</button>
      </div>

      <h3>2. 数据源生命周期</h3>
      <table class="table">
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
              <button class="btn ghost" type="button" @click="testSource(s.id)">测试连接</button>
              <button class="btn ghost" type="button" @click.stop="enableSource(s.id)">启用</button>
              <button class="btn ghost" type="button" @click.stop="disableSource(s.id)">停用</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>3. 实时接入（单次拉取 / 定时活接入）</h3>
      <div class="form-row">
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
        <label>数据名称（仅单次拉取）<input v-model="pullForm.dataName" placeholder="可空，默认源码+时间戳" /></label>
        <label>类型<input v-model="pullForm.dataType" /></label>
        <label>空间WKT（可选，默认用平台位置）<input v-model="pullForm.spatialWkt" placeholder="POINT(114.1 22.6)" /></label>
        <label>定时间隔秒<input v-model.number="liveIntervalSeconds" type="number" min="5" step="5" /></label>
        <button class="btn" type="button" :disabled="pending" @click="pullSource">立即拉取一次</button>
        <button class="btn ghost" type="button" @click="applyMapDrawSpatial('live')">采用地图范围→接入</button>
        <button class="btn" type="button" :disabled="pending" @click="startLivePull">启动定时接入</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="stopLivePull">停止定时接入</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="refreshLiveStatus()">刷新接入状态</button>
      </div>
      <p class="muted">
        单次/定时拉取都会写入观测数据，来源追溯 <code>source:数据源编码</code>。
        定时接入按间隔反复从外部协议端点拉数，属于“活接入”；停用数据源会自动停止定时任务。
      </p>
      <div v-if="liveStatus" class="live-status-card">
        <div class="live-status-head">
          <span :class="liveStatusClass(liveStatus.status)"></span>
          <strong>{{ liveStatusLabel(liveStatus.status) }}</strong>
          <span class="muted">源 #{{ liveStatus.sourceId || pullForm.sourceId }} · 间隔 {{ liveStatus.intervalSeconds || '-' }}s</span>
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

      <h3>4. 接入审计 / 失败提示</h3>
      <div class="form-row">
        <label>查看数据源
          <select v-model="selectedAuditSourceId" @change="loadSourceAudits()">
            <option value="">全部已选为空</option>
            <option v-for="s in sources" :key="'as'+s.id" :value="String(s.id)">#{{ s.id }} {{ s.code }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="loadSourceAudits()">刷新审计</button>
      </div>
      <table class="table" v-if="sourceAudits.length">
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

      <h3>5. 离线/文件样例通道（次要）</h3>
      <p class="muted">仅用于本地样例文件或离线补录，不替代协议实时接入。</p>
      <div class="form-row">
        <label>数据文件<input type="file" accept=".csv,.json,.geojson,.txt" @change="onPickFile" /></label>
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
        <label>空间WKT<input v-model="importForm.spatialWkt" /></label>
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

      <h4>文件导入任务</h4>
      <p class="muted" v-if="imports.length === 0">暂无导入任务。</p>
      <table class="table" v-else>
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
    </section>

    <section v-if="tab === 'query'" class="panel">
      <h2>监测数据综合查询与导出</h2>
      <p class="muted">支持按关键字、类型、质量、数据集、平台组合查询；导出使用同一套筛选条件。</p>
      <div class="form-row">
        <label>关键字<input v-model="q" placeholder="名称/来源/平台" /></label>
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
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="pending" @click="runDataQuery(true)">服务端查询</button>
        <button class="btn ghost" type="button" @click="doExport">导出 CSV（当前条件）</button>
        <button class="btn ghost" type="button" @click="queryServerHits = []; queryTotal = 0; queryPage = 1; message = '已重置为本地列表'">重置</button>
      </div>
      <p class="muted">
        显示 {{ filtered.length }} 条
        · 服务端本页 {{ queryServerHits.length }} / 总计 {{ queryTotal || dataList.length }}
        · 本地缓存 {{ dataList.length }}
      </p>
      <div class="form-row" v-if="queryServerHits.length || queryTotal">
        <button class="btn ghost" type="button" :disabled="pending || queryPage <= 1" @click="changeDataPage(-1)">上一页</button>
        <span class="muted">第 {{ queryPage }} 页</span>
        <button class="btn ghost" type="button" :disabled="pending || queryPage * queryPageSize >= queryTotal" @click="changeDataPage(1)">下一页</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>质量</th><th>时间</th><th>空间</th></tr></thead>
        <tbody>
          <tr v-if="!filtered.length"><td colspan="7" class="muted">无查询结果</td></tr>
          <tr v-for="d in filtered" :key="'q'+d.id" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'data' && shellSelected.id === String(d.id) }" @click="locateOnMap(String(d.id))">
            <td>{{ d.id }}</td>
            <td>{{ d.name }}</td>
            <td>{{ d.dataType }}</td>
            <td>{{ d.qualityStatus || '-' }}</td>
            <td>{{ d.timeStart }} ~ {{ d.timeEnd }}</td>
            <td><code>{{ String(d.spatialWkt || '-').slice(0, 48) }}</code></td>
          </tr>
        </tbody>
      </table>
      <pre v-if="exportPreview" class="result-pre">{{ exportPreview.slice(0, 3000) }}</pre>
    </section>

    <section v-if="tab === 'viz'" class="panel">
      <h2>监测数据可视化</h2>
      <p class="muted">空间分布请打开 GIS 工作台的数据图层；中心内提供类型/质量分布快览，详细统计在综合应用中心。</p>
      <div class="form-row" style="margin:0.5rem 0">
        <button class="btn" type="button" :disabled="shellLoading" @click="showDataOnMap">数据上图</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="filterDataQualityOnMap('unchecked')">仅未检</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="filterDataQualityOnMap('warning')">仅告警</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="filterDataQualityOnMap('anomaly')">仅异常</button>
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="filterDataQualityOnMap('')">全部数据</button>
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
          <button class="btn" type="button" :disabled="!timeMax || shellLoading" @click="applyTimeFilterOnMap">应用时间窗</button>
          <button class="btn ghost" type="button" :disabled="!timeMax || shellLoading" @click="toggleTimePlayback">{{ timePlaying ? '暂停播放' : '播放时间轴' }}</button>
          <button class="btn ghost" type="button" :disabled="shellLoading" @click="clearTimeFilterOnMap">清除时间过滤</button>
        </div>
        <p class="muted">
          范围：{{ formatTimeLabel(timeMin) }} ~ {{ formatTimeLabel(timeMax) }}
          · 当前：{{ formatTimeLabel(timeCursor) }}
          · {{ timeFilterActive ? '过滤已启用' : '未启用过滤' }}
        </p>
      </div>
      <div class="cards">
        <div class="card stat"><h3>监测数据</h3><p class="stat-num">{{ dataList.length }}</p></div>
        <div class="card stat"><h3>数据集</h3><p class="stat-num">{{ datasets.length }}</p></div>
        <div class="card stat"><h3>数据源</h3><p class="stat-num">{{ sources.length }}</p></div>
      </div>
      <div class="grid-2" style="margin-top:1rem">
        <div>
          <h3>按数据类型分布</h3>
          <table class="table">
            <thead><tr><th>类型</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!vizByType.length"><td colspan="2" class="muted">暂无类型分布</td></tr>
              <tr v-for="row in vizByType" :key="'vt'+row.name"><td>{{ row.name }}</td><td>{{ row.count }}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>按质量状态分布</h3>
          <table class="table">
            <thead><tr><th>质量状态</th><th>数量</th></tr></thead>
            <tbody>
              <tr v-if="!vizByQuality.length"><td colspan="2" class="muted">暂无质量分布</td></tr>
              <tr v-for="row in vizByQuality" :key="'vq'+row.name" class="row-click" @click="filterDataQualityOnMap(String(row.name))"><td>{{ row.name }}</td><td>{{ row.count }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="form-row" style="margin-top:1rem">
        <button class="btn" type="button" :disabled="shellLoading" @click="showDataOnMap">底图上图</button>
        <RouterLink class="btn ghost" to="/applications?tab=gis">图层控制</RouterLink>
        <RouterLink class="btn ghost" to="/applications?tab=stats">数据统计</RouterLink>
      </div>
    </section>
  </section>
</template>
