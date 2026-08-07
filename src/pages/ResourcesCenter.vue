<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import SensorMetadataView from './SensorMetadataView.vue'
import {
  applyShellSensorStatusFilter,
  closeShellRight,
  reloadShellLayers,
  applyShellSensorTypeFilter,
  setShellVisibility,
  showShellAndFit,
  selectShellFeature,
  shellCounts,
  shellSelected,
  shellStatus,
} from '../gis/mapShell'
import { mapDrawGeometry } from '../gis/mapTools'
import { errMessage, pickId } from '../utils/errors'
import type { SimpleGeometry } from '../gis/wkt'
import { tablePager as vTablePager } from '../utils/tablePager'

const route = useRoute()
const router = useRouter()
const sensorProfileId = computed(() =>
  route.path === '/resources/sensors' && typeof route.query.sensorId === 'string'
    ? route.query.sensorId
    : '',
)
const tab = ref('crud')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)

const platformTypes = ref<Record<string, unknown>[]>([])
const sensorTypes = ref<Record<string, unknown>[]>([])
const platforms = ref<Record<string, unknown>[]>([])
const sensors = ref<Record<string, unknown>[]>([])
const positionSources = ref<Record<string, unknown>[]>([])
const viz = ref<unknown>(null)
const vizFilter = ref({ typeCode: '', status: '', keyword: '' })
const qName = ref('')
const qStatus = ref('')
const qType = ref('')
const qOwner = ref('')
const queryHits = ref<Record<string, unknown>[]>([])
const queryPending = ref(false)
const queryPage = ref(1)
const queryPageSize = ref(4)
const queryTotal = ref(0)
const resourceQueryActive = ref(false)
const resourcePage = ref(1)
const editingPlatformId = ref('')
const editingSensorId = ref('')
const queryViewPage = ref(1)
const vizPage = ref(1)
const resourcePages = computed(() => [
  '平台类型',
  '传感器类型',
  editingPlatformId.value ? '编辑平台' : '新增平台',
  '平台列表',
  editingSensorId.value ? '编辑传感器' : '新增传感器',
  '传感器列表',
  '高级接入',
])
const queryViewPages = ['查询条件', '查询结果']
const vizPages = ['筛选与上图', '资源摘要']

function sensorPlatform(sensor: Record<string, unknown>) {
  const platformId = String(sensor.platformId ?? '')
  return platforms.value.find((platform) => String(platform.id) === platformId) || {}
}

function sensorStatusLabel(value: unknown) {
  const status = String(value ?? '').trim().toLowerCase()
  const labels: Record<string, string> = {
    active: '启用',
    inactive: '停用',
    enabled: '启用',
    disabled: '停用',
    maintenance: '维护中',
  }
  return labels[status] || String(value || '未设置')
}

function sensorSensingCodes(sensor: Record<string, unknown>) {
  return Array.isArray(sensor.sensingElementCodes) ? sensor.sensingElementCodes.map(String) : []
}

function sensorMeasurementCount(sensor: Record<string, unknown>) {
  return Array.isArray(sensor.measurementItems) ? sensor.measurementItems.length : 0
}

function sensorCompletenessRatio(sensor: Record<string, unknown>) {
  const completeness = sensor.profileCompleteness
  return completeness && typeof completeness === 'object' ? Number((completeness as Record<string, unknown>).ratio || 0) : 0
}

const platformForm = ref({
  platformTypeId: '',
  name: '',
  identifier: '',
  locationGeoJson: { type: 'Point', coordinates: [114.05, 22.55] } as SimpleGeometry | null,
  owner: '演示单位',
  status: 'active',
})
const sensorForm = ref({
  platformId: '',
  sensorName: '',
  sensorTypeId: '',
  accuracyPercent: 90,
  coverageGeoJson: null as SimpleGeometry | null,
})
const satelliteAccessForm = ref({
  name: '',
  noradNumber: '',
  orbitType: 'LEO',
  updateIntervalHours: 1,
  sensorName: '',
  sensorTypeId: '',
  swathKm: null as number | null,
  spatialResolutionM: null as number | null,
})
const positionSourceForm = ref({
  platformId: '',
  protocol: 'https-json',
  endpointAddress: '',
  ingestionMode: 'push',
  authMethod: 'none',
  credentialReference: '',
  samplingIntervalSeconds: 5,
  status: 'enabled',
})

const tabs = [
  { key: 'crud', label: '传感器资源管理' },
  { key: 'capabilities', label: '观测能力管理' },
  { key: 'query', label: '资源查询' },
  { key: 'viz', label: '资源可视化' },
]

const filteredPlatforms = computed(() => {
  // 初始列表与查询结果都来自后端；筛选仅用于当前服务端结果的即时呈现。
  const base = resourceQueryActive.value ? queryHits.value : platforms.value
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
const resourceQueryCount = computed(() => resourceQueryActive.value ? queryTotal.value : filteredPlatforms.value.length)
const resourceQueryPageCount = computed(() => Math.max(1, Math.ceil(resourceQueryCount.value / queryPageSize.value)))
const displayedPlatforms = computed(() => resourceQueryActive.value
  ? filteredPlatforms.value
  : filteredPlatforms.value.slice((queryPage.value - 1) * queryPageSize.value, queryPage.value * queryPageSize.value))
const resourceQueryPageLabels = computed(() => Array.from({ length: resourceQueryPageCount.value }, (_, index) => `资源查询第 ${index + 1} 页`))

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
    resourceQueryActive.value = true
    if (resetPage) queryViewPage.value = 2
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

async function setResourcePage(page: number) {
  const next = Math.min(resourceQueryPageCount.value, Math.max(1, page))
  if (next === queryPage.value) return
  queryPage.value = next
  if (resourceQueryActive.value) await runResourceQuery(false)
}

async function resetResourceQuery() {
  qName.value = ''
  qStatus.value = ''
  qType.value = ''
  qOwner.value = ''
  queryHits.value = []
  queryTotal.value = 0
  queryPage.value = 1
  resourceQueryActive.value = false
  await runResourceQuery(true)
  if (!error.value) message.value = '查询条件已重置，已重新读取服务端资源数据'
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
  const q: Record<string, string> = { ...Object.fromEntries(
    Object.entries(route.query).filter(([, v]) => v != null && !Array.isArray(v)).map(([k, v]) => [k, String(v)]),
  ), tab: key }
  await router.replace({ path: route.path, query: q })
}
function syncTab() {
  const q = route.query.tab
  if (typeof q === 'string' && tabs.some((t) => t.key === q)) tab.value = q
}


function applyMapDrawToPlatform() {
  const g = mapDrawGeometry.value
  if (!g || !g.geojson) {
    error.value = '请先用地图工具绘点或绘面（绘点=位置，绘面=覆盖示意）'
    return
  }
  platformForm.value.locationGeoJson = g.geojson
  message.value = g.type === 'point' ? '已采用地图点位作为平台位置' : '已采用地图范围作为平台空间位置'
  error.value = null
}

function applyMapDrawToSensor() {
  const g = mapDrawGeometry.value
  if (!g || !g.geojson) {
    error.value = '请先用地图工具绘面（覆盖范围）或绘点'
    return
  }
  if (g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const d = 0.05
    sensorForm.value.coverageGeoJson = {
      type: 'Polygon',
      coordinates: [[
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ]],
    }
    message.value = '已将地图点位扩展为小范围覆盖区域'
  } else {
    sensorForm.value.coverageGeoJson = g.geojson
    message.value = '已采用地图绘制范围作为传感器覆盖区域'
  }
  error.value = null
}

async function load() {
  error.value = null
  try {
    const [pt, st, p, s, ps] = await Promise.all([
      api.listPlatformTypes(),
      api.listSensorTypes(),
      api.listPlatforms(),
      api.listSensors(),
      api.listPositionSources(),
    ])
    platformTypes.value = pt.data
    sensorTypes.value = st.data
    platforms.value = p.data
    sensors.value = s.data
    positionSources.value = ps.data
    if (platformForm.value.platformTypeId === '' && platformTypes.value[0]) {
      platformForm.value.platformTypeId = pickId(platformTypes.value[0])
    }
    if (sensorForm.value.sensorTypeId === '' && sensorTypes.value[0]) {
      sensorForm.value.sensorTypeId = pickId(sensorTypes.value[0])
    }
    if (satelliteAccessForm.value.sensorTypeId === '' && sensorTypes.value[0]) {
      satelliteAccessForm.value.sensorTypeId = pickId(sensorTypes.value[0])
    }
    if (sensorForm.value.platformId === '' && platforms.value[0]) {
      sensorForm.value.platformId = pickId(platforms.value[0])
    }
    if (positionSourceForm.value.platformId === '' && platforms.value[0]) {
      positionSourceForm.value.platformId = pickId(platforms.value[0])
      applyExistingPositionSource()
    }
    applyRouteSensorCreate()
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
}

async function createPlatform() {
  if (platformForm.value.platformTypeId === '' || platformForm.value.name === '') {
    error.value = '请选择平台类型并填写名称（表单内容已保留）'
    return
  }
  if (!editingPlatformId.value && !platformForm.value.locationGeoJson) {
    error.value = '请先在地图绘制平台位置或范围'
    return
  }
  pending.value = true
  error.value = null
  try {
    const body: Record<string, unknown> = {
      platformTypeId: Number(platformForm.value.platformTypeId),
      name: platformForm.value.name,
      identifier: editingPlatformId.value ? platformForm.value.identifier : (platformForm.value.identifier || undefined),
      owner: editingPlatformId.value ? platformForm.value.owner : (platformForm.value.owner || undefined),
      status: platformForm.value.status || 'active',
    }
    if (platformForm.value.locationGeoJson) body.locationGeoJson = platformForm.value.locationGeoJson
    const res = editingPlatformId.value
      ? await api.updatePlatform(editingPlatformId.value, body)
      : await api.createPlatform(body)
    const newId = (res.data as any)?.id ?? (res as any)?.id
    message.value = editingPlatformId.value ? '平台资料修改已保存' : (newId ? ('平台已创建 #' + newId) : '平台已创建')
    editingPlatformId.value = ''
    try { await reloadShellLayers('/resources', {}) } catch { /* 地图刷新失败不影响主流程 */ }
    if (newId != null) {
      try { await locateOnMap('sensor', newId) } catch { /* 地图定位为可选步骤 */ }
    }
    platformForm.value.name = ''
    platformForm.value.identifier = ''
    // 如果用户没有清除位置，则连续创建时保留相近区域的位置。
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败（表单内容已保留）')
  } finally {
    pending.value = false
  }
}

function editPlatform(item: Record<string, unknown>) {
  editingPlatformId.value = String(item.id)
  platformForm.value = {
    platformTypeId: String(item.platformTypeId || ''),
    name: String(item.name || ''),
    identifier: String(item.identifier || ''),
    locationGeoJson: (item.locationGeoJson as SimpleGeometry | null) || null,
    owner: String(item.owner || ''),
    status: String(item.status || 'active'),
  }
  resourcePage.value = 3
  message.value = `正在编辑平台“${item.name}”`
}

function cancelPlatformEdit() {
  editingPlatformId.value = ''
  platformForm.value.name = ''
  platformForm.value.identifier = ''
  platformForm.value.locationGeoJson = null
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
    try { await reloadShellLayers('/resources', {}) } catch { /* 地图刷新失败不影响主流程 */ }
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
    const body: Record<string, unknown> = {
      platformId: sensorForm.value.platformId ? Number(sensorForm.value.platformId) : undefined,
      sensorName: sensorForm.value.sensorName,
      sensorTypeId: sensorForm.value.sensorTypeId ? Number(sensorForm.value.sensorTypeId) : undefined,
      accuracyPercent: String(sensorForm.value.accuracyPercent).trim() === ''
        ? null
        : Number(sensorForm.value.accuracyPercent),
    }
    if (sensorForm.value.coverageGeoJson) body.coverageGeoJson = sensorForm.value.coverageGeoJson
    if (editingSensorId.value) await api.updateSensor(editingSensorId.value, body)
    else await api.createSensor(body)
    message.value = editingSensorId.value ? '传感器资料修改已保存' : '传感器已创建'
    editingSensorId.value = ''
    try { await reloadShellLayers('/resources', {}) } catch { /* 地图刷新失败不影响主流程 */ }
    sensorForm.value.sensorName = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

function cancelSensorEdit() {
  editingSensorId.value = ''
  sensorForm.value.sensorName = ''
  sensorForm.value.coverageGeoJson = null
}

async function removeSensor(id: unknown) {
  if (window.confirm('确认删除传感器？') === false) return
  try {
    await api.deleteSensor(String(id))
    message.value = '传感器已删除'
    try { await reloadShellLayers('/resources', {}) } catch { /* 地图刷新失败不影响主流程 */ }
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

function trajectoryStatus(row: Record<string, unknown>) {
  const trajectory = (row.trajectory || {}) as {
    available?: boolean
    source?: string
    generatedAt?: string
    points?: unknown[]
  }
  if (!trajectory.available) {
    return String(row.typeCode || '') === 'satellite' ? '未同步真实轨迹' : '-'
  }
  const generated = trajectory.generatedAt
    ? new Date(trajectory.generatedAt).toLocaleString('zh-CN')
    : '时间未知'
  const count = Array.isArray(trajectory.points) ? trajectory.points.length : 0
  const label = String(row.typeCode || '') === 'satellite' ? '真实轨道' : '实际位置轨迹'
  return `${label} · ${trajectory.source || '位置接口'} · ${count} 点 · ${generated}`
}

async function syncSatellite(row: Record<string, unknown>) {
  const platformId = row.platformId || row.id
  if (platformId == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.syncSatelliteOnline(String(platformId))
    const count = Number((res.data as any)?.track?.pointCount || 0)
    await loadViz()
    await reloadShellLayers('/resources', {})
    await locateOnMap('sensor', String(platformId))
    message.value = `真实卫星轨迹已更新，共 ${count} 个三维时序点`
  } catch (err) {
    error.value = errMessage(err, '真实卫星轨迹同步失败')
  } finally {
    pending.value = false
  }
}

async function accessSatellite() {
  const name = satelliteAccessForm.value.name.trim()
  const noradNumber = satelliteAccessForm.value.noradNumber.trim()
  const sensorName = satelliteAccessForm.value.sensorName.trim()
  if (!name || !/^\d{1,20}$/.test(noradNumber) || !sensorName || !satelliteAccessForm.value.sensorTypeId) {
    error.value = '请填写卫星、NORAD 编号和星载传感器信息'
    return
  }
  pending.value = true
  error.value = null
  try {
    const res = await api.accessSatelliteOnline({
      name,
      noradNumber,
      orbitType: satelliteAccessForm.value.orbitType,
      updateIntervalHours: Number(satelliteAccessForm.value.updateIntervalHours),
      sensorName,
      sensorTypeId: Number(satelliteAccessForm.value.sensorTypeId),
      swathKm: satelliteAccessForm.value.swathKm,
      spatialResolutionM: satelliteAccessForm.value.spatialResolutionM,
    })
    const platformId = (res.data as any)?.platform?.id
    const pointCount = Number((res.data as any)?.track?.pointCount || 0)
    satelliteAccessForm.value.name = ''
    satelliteAccessForm.value.noradNumber = ''
    satelliteAccessForm.value.sensorName = ''
    await load()
    await loadViz()
    await reloadShellLayers('/resources', {})
    if (platformId != null) await locateOnMap('sensor', String(platformId))
    message.value = `卫星已接入 CelesTrak，真实轨迹 ${pointCount} 个时序点；服务器将按策略定时更新`
  } catch (err) {
    error.value = errMessage(err, '卫星接入失败，请核对 NORAD 编号或网络状态')
  } finally {
    pending.value = false
  }
}

function applyExistingPositionSource() {
  const existing = positionSources.value.find(
    (item) => String(item.platformId) === String(positionSourceForm.value.platformId),
  )
  if (!existing) {
    positionSourceForm.value.protocol = 'https-json'
    positionSourceForm.value.endpointAddress = ''
    positionSourceForm.value.ingestionMode = 'push'
    positionSourceForm.value.authMethod = 'none'
    positionSourceForm.value.credentialReference = ''
    positionSourceForm.value.samplingIntervalSeconds = 5
    positionSourceForm.value.status = 'enabled'
    return
  }
  positionSourceForm.value.protocol = String(existing.protocol || 'https-json')
  positionSourceForm.value.endpointAddress = String(existing.endpointAddress || '')
  positionSourceForm.value.ingestionMode = String(existing.ingestionMode || 'push')
  positionSourceForm.value.authMethod = String(existing.authMethod || 'none')
  positionSourceForm.value.credentialReference = String(existing.credentialReference || '')
  positionSourceForm.value.samplingIntervalSeconds = Number(existing.samplingIntervalSeconds || 5)
  positionSourceForm.value.status = String(existing.status || 'enabled')
}

async function savePositionSource() {
  if (!positionSourceForm.value.platformId || !positionSourceForm.value.endpointAddress.trim()) {
    error.value = '请选择移动平台并填写位置接口地址'
    return
  }
  pending.value = true
  error.value = null
  const body = {
    platformId: Number(positionSourceForm.value.platformId),
    protocol: positionSourceForm.value.protocol,
    endpointAddress: positionSourceForm.value.endpointAddress.trim(),
    ingestionMode: positionSourceForm.value.ingestionMode,
    authMethod: positionSourceForm.value.authMethod,
    credentialReference: positionSourceForm.value.credentialReference.trim(),
    messageMapping: {
      time: 'time',
      longitude: 'longitude',
      latitude: 'latitude',
      altitudeM: 'altitudeM',
      speedMps: 'speedMps',
      headingDegrees: 'headingDegrees',
    },
    samplingIntervalSeconds: Number(positionSourceForm.value.samplingIntervalSeconds),
    status: positionSourceForm.value.status,
  }
  try {
    const existing = positionSources.value.find(
      (item) => String(item.platformId) === String(positionSourceForm.value.platformId),
    )
    if (existing) await api.updatePositionSource(positionSourceForm.value.platformId, body)
    else await api.createPositionSource(body)
    message.value = '位置轨迹源已保存；平台实际轨迹与传感器观测数据将分别管理'
    await load()
  } catch (err) {
    error.value = errMessage(err, '位置轨迹源保存失败')
  } finally {
    pending.value = false
  }
}

onMounted(async () => {
  syncTab()
  await load()
  if (tab.value === 'viz') await loadViz()
  applyRouteLocationHint()
})
watch(() => route.query.tab, syncTab)
watch(
  () => [route.query.lon, route.query.lat],
  () => applyRouteLocationHint(),
)

function applyRouteLocationHint() {
  const lon = Number(Array.isArray(route.query.lon) ? route.query.lon[0] : route.query.lon)
  const lat = Number(Array.isArray(route.query.lat) ? route.query.lat[0] : route.query.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  platformForm.value.locationGeoJson = { type: 'Point', coordinates: [lon, lat] }
  message.value = `已根据地图位置预填平台点位（${lon.toFixed(5)}, ${lat.toFixed(5)}）`
}
function applyRouteSensorCreate() {
  if (String(route.query.createSensor || '') !== '1') return
  const platformId = String(route.query.platformId || '')
  if (!platformId || !platforms.value.some((platform) => String(platform.id) === platformId)) return
  const platform = platforms.value.find((item) => String(item.id) === platformId) || {}
  resourcePage.value = 5
  editingSensorId.value = ''
  sensorForm.value.platformId = platformId
  if (!sensorForm.value.sensorName) {
    sensorForm.value.sensorName = String(route.query.sensorName || `${platform.name || `平台 #${platformId}`}·传感器档案`)
  }
  message.value = `已为“${platform.name || `平台 #${platformId}`}”预填新增传感器表单`
}
watch(tab, async (v) => { if (v === 'viz') await loadViz() })
watch(() => [route.query.createSensor, route.query.platformId, route.query.sensorName], applyRouteSensorCreate)


async function locateOnMap(kind: 'sensor', id: string | number | unknown) {
  setShellVisibility({ showSensors: true, showData: false, showTasks: false })
  const ok = await selectShellFeature(kind, String(id), { openBubble: true, fly: true })
  message.value = ok
    ? `已在地图定位传感器 #${id}`
    : `地图未找到传感器 #${id} 的空间位置（可能缺少坐标或覆盖范围）`
  if (!ok) error.value = message.value
  else error.value = null
}

async function openSensorProfile(id: string | number | unknown, section = 'general', mode = 'edit', targetTab = 'crud', focus = '') {
  closeShellRight()
  const query = { ...route.query, tab: targetTab, sensorId: String(id), section, mode, focus: focus || undefined }
  await router.push({
    name: 'resource-sensors',
    query,
  })
}

async function closeSensorProfile() {
  const query = { ...route.query }
  delete query.sensorId
  delete query.section
  delete query.mode
  delete query.focus
  await router.replace({ name: 'resource-sensors', query: { ...query, tab: 'crud' } })
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
    <template v-if="sensorProfileId">
      <header class="page-head profile-page-head">
        <div><p class="eyebrow">资源档案</p><h1>传感器详情</h1></div>
        <button class="btn ghost" type="button" @click="closeSensorProfile">返回资源列表</button>
      </header>
      <SensorMetadataView :sensor-id="sensorProfileId" embedded />
    </template>
    <template v-else>
    <header class="page-head">
      <div>
        <p class="eyebrow">传感资源中心</p>
        <h1>传感器类型、资源建模与查询</h1>
      </div>
    </header>
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>
      <div class="plan-map-actions panel soft" data-testid="resources-map-actions">
        <strong style="font-size:12px;margin-right:0.35rem">地图联动</strong>
        <button class="btn ghost" type="button" :disabled="pending" @click="showOnMap">资源上图</button>
        <span class="muted" style="font-size:12px">{{ shellStatus }}</span>
      </div>

    <section v-if="tab === 'capabilities'" class="panel">
      <h2>观测能力管理</h2>
      <p class="muted">维护传感器观测能力；点击名称可查看传感器完整档案，进入编辑可直接定位到对应分区。</p>
      <table v-table-pager="{ label: '观测能力分页' }" class="table capability-table">
        <thead><tr><th>资源 / 平台</th><th>感知要素 / 量测项</th><th>分辨率</th><th>精度 / 可靠度</th><th>档案完整度</th><th class="capability-status">状态</th><th class="capability-ops">操作</th></tr></thead>
        <tbody>
          <tr v-if="!sensors.length"><td colspan="7" class="muted">暂无传感器资源，请先在资源管理中登记。</td></tr>
          <tr v-for="sensor in sensors" :key="String(sensor.id)">
            <td>
              <div class="capability-resource">
                <button class="link-button" type="button" @click="openSensorProfile(sensor.id, 'attributes', 'view', 'capabilities')">{{ sensor.sensorName || sensor.name || '-' }}</button>
                <small>{{ sensorPlatform(sensor).name || sensor.platformId || '-' }}</small>
              </div>
            </td>
            <td><span v-if="sensorSensingCodes(sensor).length">{{ sensorSensingCodes(sensor).join('、') }}</span><span v-else>未维护</span><small>{{ sensorMeasurementCount(sensor) }} 个量测项</small></td>
            <td>{{ sensor.spatialResolutionM ?? '-' }}m / {{ sensor.temporalResolutionSeconds ?? '-' }}s</td>
            <td>{{ sensor.accuracyPercent ?? '-' }}% / {{ sensor.reliabilityPercent ?? '-' }}%</td>
            <td>{{ Math.round(sensorCompletenessRatio(sensor) * 100) }}%</td>
            <td class="capability-status">{{ sensorStatusLabel(sensor.status || sensorPlatform(sensor).status) }}</td>
            <td class="ops capability-ops"><button class="btn ghost" type="button" @click="openSensorProfile(sensor.id, 'attributes', 'edit', 'capabilities')">编辑观测能力</button><button class="btn ghost" type="button" @click="openSensorProfile(sensor.id, 'general', 'edit', 'capabilities', 'incomplete')">维护完整档案</button><button class="btn ghost" type="button" @click="locateOnMap('sensor', String(sensor.platformId || sensor.id))">地图定位</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'crud'" class="panel resource-workspace-panel">
      <h2>传感器资源管理</h2>
      <p class="muted">登记平台与传感器资源，维护类型、单位、位置、状态和覆盖范围。</p>
      <div class="resource-workspace-content">
      <div v-if="resourcePage === 1">
          <h3>平台类型（{{ platformTypes.length }}）</h3>
          <table v-table-pager="{ label: '平台类型分页' }" class="table">
            <thead><tr><th>ID</th><th>编码</th><th>名称</th></tr></thead>
            <tbody>
              <tr v-if="!platformTypes.length"><td colspan="3" class="muted">暂无平台类型</td></tr>
              <tr v-for="t in platformTypes" :key="'pt'+t.id"><td>{{ t.id }}</td><td><code>{{ t.code }}</code></td><td>{{ t.name }}</td></tr>
            </tbody>
          </table>
      </div>
      <div v-else-if="resourcePage === 2">
          <h3>传感器类型（{{ sensorTypes.length }}）</h3>
          <table v-table-pager="{ label: '传感器类型分页' }" class="table">
            <thead><tr><th>ID</th><th>编码</th><th>名称</th></tr></thead>
            <tbody>
              <tr v-if="!sensorTypes.length"><td colspan="3" class="muted">暂无传感器类型</td></tr>
              <tr v-for="t in sensorTypes" :key="'st'+t.id"><td>{{ t.id }}</td><td><code>{{ t.code }}</code></td><td>{{ t.name }}</td></tr>
            </tbody>
          </table>
      </div>
      <template v-if="resourcePage === 7">
      <details class="advanced-entry">
        <summary><span><strong>卫星在线接入</strong><small>TLE / SGP4 动态轨道与星载传感器</small></span><em>高级接入</em></summary>
        <div class="advanced-entry-body">
        <div class="form-row">
          <label>卫星名称<input v-model="satelliteAccessForm.name" placeholder="例如 Sentinel-2B" /></label>
          <label>NORAD 编号<input v-model="satelliteAccessForm.noradNumber" inputmode="numeric" placeholder="例如 42063" /></label>
          <label>轨道类型
            <select v-model="satelliteAccessForm.orbitType">
              <option value="LEO">低地球轨道 LEO</option>
              <option value="MEO">中地球轨道 MEO</option>
              <option value="GEO">地球同步轨道 GEO</option>
              <option value="HEO">高椭圆轨道 HEO</option>
            </select>
          </label>
          <label>同步周期
            <select v-model.number="satelliteAccessForm.updateIntervalHours">
              <option :value="1">每 1 小时</option>
              <option :value="3">每 3 小时</option>
              <option :value="6">每 6 小时</option>
              <option :value="12">每 12 小时</option>
              <option :value="24">每 24 小时</option>
            </select>
          </label>
          <label>星载传感器名称<input v-model="satelliteAccessForm.sensorName" placeholder="例如 MSI 多光谱成像仪" /></label>
          <label>传感器类型
            <select v-model="satelliteAccessForm.sensorTypeId">
              <option value="">请选择</option>
              <option v-for="t in sensorTypes" :key="'sat-st'+t.id" :value="String(t.id)">{{ t.name }}</option>
            </select>
          </label>
          <label>观测幅宽 km<input v-model.number="satelliteAccessForm.swathKm" type="number" min="0.001" placeholder="可选" /></label>
          <label>空间分辨率 m<input v-model.number="satelliteAccessForm.spatialResolutionM" type="number" min="0.001" placeholder="可选" /></label>
          <button class="btn" type="button" :disabled="pending" @click="accessSatellite">验证并接入</button>
        </div>
        <p class="muted">轨道协议：HTTPS / CelesTrak TLE / SGP4。遥感影像及其覆盖面属于观测数据，需由真实产品元数据或文件导入，不会用卫星当前位置代替。</p>
        </div>
      </details>
      <details class="advanced-entry">
        <summary><span><strong>移动平台位置 / 轨迹接入</strong><small>无人机、走航车和船舶实际运行轨迹</small></span><em>高级接入</em></summary>
        <div class="advanced-entry-body">
        <div class="form-row">
          <label>移动平台
            <select v-model="positionSourceForm.platformId" @change="applyExistingPositionSource">
              <option value="">请选择</option>
              <option v-for="p in platforms" :key="'pos-p'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }}</option>
            </select>
          </label>
          <label>位置协议
            <select v-model="positionSourceForm.protocol">
              <option value="https-json">HTTP/HTTPS JSON</option>
              <option value="mqtt">MQTT 网关</option>
              <option value="mavlink-gateway">MAVLink 网关</option>
              <option value="ais-gateway">AIS 网关</option>
              <option value="jt808-gateway">JT/T 808 网关</option>
            </select>
          </label>
          <label>接口地址<input v-model="positionSourceForm.endpointAddress" placeholder="https://gateway.example/positions" /></label>
          <label>接入方式
            <select v-model="positionSourceForm.ingestionMode">
              <option value="push">网关推送</option>
              <option value="pull">服务端拉取</option>
            </select>
          </label>
          <label>认证方式
            <select v-model="positionSourceForm.authMethod">
              <option value="none">无需认证</option>
              <option value="bearer">Bearer（仅保存凭据引用）</option>
              <option value="api-key">API Key（仅保存凭据引用）</option>
            </select>
          </label>
          <label>凭据引用<input v-model="positionSourceForm.credentialReference" placeholder="例如 env:UAV_POSITION_TOKEN" /></label>
          <label>采样间隔 秒<input v-model.number="positionSourceForm.samplingIntervalSeconds" type="number" min="1" max="86400" /></label>
          <label>状态
            <select v-model="positionSourceForm.status">
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <button class="btn" type="button" :disabled="pending" @click="savePositionSource">保存位置源</button>
        </div>
        <p class="muted">统一写入接口：<code>/api/v1/observations/platform-tracks/ingest</code>。地图展示的是实际位置轨迹；规划航线和观测覆盖范围使用独立图层。</p>
        </div>
      </details>
      </template>
      <template v-if="resourcePage === 3">
      <h3>{{ editingPlatformId ? '编辑平台资料' : '新增平台' }}</h3>
      <div class="form-row">
        <label>平台类型
          <select v-model="platformForm.platformTypeId">
            <option v-for="t in platformTypes" :key="'pft'+t.id" :value="String(t.id)">{{ t.name }}</option>
          </select>
        </label>
        <label>名称<input v-model="platformForm.name" /></label>
        <label>标识<input v-model="platformForm.identifier" /></label>
        <div class="spatial-pick" :class="{ ready: platformForm.locationGeoJson }">
          <span>{{ platformForm.locationGeoJson ? '平台位置已设置' : '平台位置未设置' }}</span>
          <button class="btn ghost" type="button" @click="applyMapDrawToPlatform">采用地图绘制位置</button>
        </div>
        <label>所属单位<input v-model="platformForm.owner" /></label>
        <label>状态<select v-model="platformForm.status"><option value="active">启用</option><option value="inactive">停用</option></select></label>
        <div class="form-actions"><button class="btn" type="button" :disabled="pending" @click="createPlatform">{{ editingPlatformId ? '保存修改' : '新增平台' }}</button><button v-if="editingPlatformId" class="btn ghost" type="button" @click="cancelPlatformEdit">取消编辑</button></div>
      </div>
      </template>
      <template v-if="resourcePage === 4">
      <h3>平台列表</h3>
      <table v-table-pager="{ label: '平台资源分页' }" class="table">
        <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>标识</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!platforms.length"><td colspan="6" class="muted">暂无平台/传感器资源，请先新增平台</td></tr>
          <tr v-for="p in platforms" :key="String(p.id)" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'sensor' && shellSelected.id === String(p.id) }" @click="locateOnMap('sensor', String(p.id))">
            <td>{{ p.id }}</td><td>{{ p.name }}</td><td>{{ p.platformTypeId }}</td><td><code>{{ p.identifier }}</code></td><td>{{ p.status }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="locateOnMap('sensor', String(p.id))">定位</button>
              <button class="btn ghost" type="button" @click.stop="editPlatform(p)">编辑</button>
              <button class="btn ghost" type="button" @click.stop="setPlatformStatus(p.id, 'active')">启用</button>
              <button class="btn ghost" type="button" @click.stop="setPlatformStatus(p.id, 'inactive')">停用</button>
              <button class="btn ghost" type="button" @click.stop="removePlatform(p.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      </template>
      <template v-if="resourcePage === 5">
      <h3>{{ editingSensorId ? '编辑传感器资料' : '新增传感器' }}</h3>
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
        <div class="spatial-pick" :class="{ ready: sensorForm.coverageGeoJson }">
          <span>{{ sensorForm.coverageGeoJson ? '覆盖区域已设置' : '覆盖区域未设置' }}</span>
          <button class="btn ghost" type="button" @click="applyMapDrawToSensor">采用地图绘制覆盖</button>
        </div>
        <div class="form-actions"><button class="btn" type="button" :disabled="pending" @click="createSensor">{{ editingSensorId ? '保存修改' : '新增传感器' }}</button><button v-if="editingSensorId" class="btn ghost" type="button" @click="cancelSensorEdit">取消编辑</button></div>
      </div>
      </template>
      <template v-if="resourcePage === 6">
      <h3>传感器列表</h3>
      <table v-table-pager="{ label: '传感器分页' }" class="table">
        <thead><tr><th>ID</th><th>名称</th><th>平台</th><th>类型</th><th>精度</th><th></th></tr></thead>
        <tbody>
          <tr v-if="!sensors.length"><td colspan="6" class="muted">暂无传感器记录</td></tr>
          <tr v-for="s in sensors" :key="'s'+s.id" class="row-click" @click="locateOnMap('sensor', String(s.platformId || s.id))">
            <td>{{ s.id }}</td>
            <td><button class="link-button" type="button" @click.stop="openSensorProfile(s.id, 'general', 'view', 'crud')">{{ s.sensorName || s.name || s.id }}</button></td>
            <td>{{ s.platformId }}</td>
            <td>{{ s.sensorTypeId }}</td>
            <td>{{ s.accuracyPercent ?? '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click.stop="openSensorProfile(s.id, 'general', 'edit', 'crud')">编辑基础信息</button>
              <button class="btn ghost" type="button" @click.stop="openSensorProfile(s.id, 'general', 'edit', 'crud', 'incomplete')">维护完整档案</button>
              <button class="btn ghost" type="button" @click.stop="locateOnMap('sensor', String(s.platformId || s.id))">定位</button>
              <button class="btn ghost" type="button" @click.stop="removeSensor(s.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      </template>
      </div>
      <CardPager v-model:page="resourcePage" :pages="resourcePages" label="传感器资源管理步骤" />
    </section>

    <section v-if="tab === 'query'" class="panel section-workspace-panel">
      <h2>传感器综合查询</h2>
      <p class="muted">按类型、名称/编码、所属单位、运行状态组合筛选；优先走服务端过滤，结果可被规划中心候选筛选使用。</p>
      <div class="section-workspace-content">
      <template v-if="queryViewPage === 1">
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
            <option :value="4">4</option>
            <option :value="8">8</option>
            <option :value="12">12</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="queryPending" @click="runResourceQuery(true)">服务端查询</button>
        <button class="btn ghost" type="button" @click="resetResourceQuery">重置</button>
      </div>
      </template>
      <template v-if="queryViewPage === 2">
      <p class="muted">显示 {{ filteredPlatforms.length }} · 服务端本页 {{ queryHits.length }} / 总计 {{ queryTotal }}</p>
      <div class="table-region">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>标识</th><th>所属单位</th><th>位置</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-if="!displayedPlatforms.length"><td colspan="7" class="muted">无匹配查询结果</td></tr>
              <tr v-for="p in displayedPlatforms" :key="'f'+p.id" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'sensor' && shellSelected.id === String(p.id) }" @click="locateOnMap('sensor', String(p.id))">
                <td>{{ p.id }}</td>
                <td>{{ p.name }}</td>
                <td>{{ p.platformTypeName || p.platformTypeId || p.platformType || '-' }}</td>
                <td>{{ p.identifier }}</td>
                <td>{{ p.owner || '-' }}</td>
                <td>{{ p.locationGeoJson || p.locationWkt ? '已定位' : '未定位' }}</td>
                <td>{{ p.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CardPager :page="queryPage" kind="records" :pages="resourceQueryPageLabels" :summary="`共 ${resourceQueryCount} 条`" label="资源查询分页" @update:page="setResourcePage" />
      </div>
      </template>
      </div>
      <CardPager v-model:page="queryViewPage" :pages="queryViewPages" label="资源查询内容分页" />
    </section>

    <section v-if="tab === 'viz'" class="panel section-workspace-panel">
      <h2>资源可视化</h2>
      <p class="muted">先按类型/状态摘要核对资源空间与能力信息，再进入 GIS 工作台做地图叠加。</p>
      <div class="section-workspace-content">
      <template v-if="vizPage === 1">
      <div class="form-row">
        <label>类型编码<input v-model="vizFilter.typeCode" placeholder="station" /></label>
        <label>状态<input v-model="vizFilter.status" placeholder="active" /></label>
        <label>关键字<input v-model="vizFilter.keyword" /></label>
        <button class="btn" type="button" @click="loadViz(); vizPage = 2">刷新摘要</button>
        <button class="btn" type="button" :disabled="pending" @click="showOnMap">底图上图</button>
        <button class="btn ghost" type="button" :disabled="pending" @click="showOnMap">图层刷新上图</button>
      </div>
      </template>
      <template v-if="vizPage === 2">
      <p class="muted">摘要条数 {{ vizRows.length }}</p>
      <table v-if="vizRows.length" v-table-pager="{ label: '资源摘要分页' }" class="table resource-summary-table">
        <thead>
          <tr>
            <th>ID</th><th>名称</th><th>类型</th><th>状态</th><th>单位</th><th>位置</th><th>轨迹数据</th><th>能力摘要</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!vizRows.length"><td colspan="9" class="muted">暂无可视化资源，请先上图或调整筛选</td></tr>
          <tr v-for="row in vizRows" :key="String(row.platformId || row.id)" class="row-click" @click="locateOnMap('sensor', String(row.platformId || row.id))">
            <td>{{ row.platformId || row.id }}</td>
            <td>{{ row.platformName || row.name }}</td>
            <td>{{ row.typeName || row.typeCode }}</td>
            <td>{{ row.status || '-' }}</td>
            <td>{{ row.owner || '-' }}</td>
            <td>{{ (row.trajectory as any)?.available ? (String(row.typeCode || '') === 'satellite' ? '轨道定位' : '动态定位') : (row.locationGeoJson || row.locationWkt || (row.spatial as any)?.positionWkt ? '固定位置' : '未定位') }}</td>
            <td class="clamp">{{ trajectoryStatus(row) }}</td>
            <td class="clamp">{{ JSON.stringify(row.capabilitySummary || row.typeSummary || {}).slice(0, 80) }}</td>
            <td class="ops">
              <button v-if="String(row.typeCode || '') === 'satellite'" class="btn ghost" type="button" :disabled="pending" @click.stop="syncSatellite(row)">同步真实轨迹</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无可视化摘要，点击刷新或调整筛选。</p>
      </template>
      </div>
      <CardPager v-model:page="vizPage" :pages="vizPages" label="资源可视化内容分页" />
    </section>
    </template>
  </section>
</template>

<style scoped>
.page > .panel { border-radius: 16px; }
.form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
.page .table.resource-summary-table { min-width: 920px; }
.table-scroll .capability-table { width: 100%; min-width: 0; margin: 0; table-layout: fixed; }
.capability-table th, .capability-table td { white-space: normal; overflow-wrap: anywhere; }
.capability-table th:nth-child(1), .capability-table td:nth-child(1) { width: 20%; }
.capability-table th:nth-child(2), .capability-table td:nth-child(2) { width: 17%; }
.capability-table th:nth-child(3), .capability-table td:nth-child(3) { width: 13%; }
.capability-table th:nth-child(4), .capability-table td:nth-child(4) { width: 13%; }
.capability-table th:nth-child(5), .capability-table td:nth-child(5) { width: 10%; }
.capability-table th:nth-child(6), .capability-table td:nth-child(6) { width: 10%; }
.capability-table th:nth-child(7), .capability-table td:nth-child(7) { width: 17%; }
.capability-resource { display: grid; gap: .12rem; min-width: 0; }
.capability-resource strong { color: #3a3a3c; font-size: 11px; line-height: 1.25; }
.capability-resource small, .capability-table td small { display: block; color: #6e6e73; font-size: 11px; line-height: 1.25; }
.capability-table td.capability-ops { display: table-cell; min-width: 0; white-space: normal; }
.capability-table .capability-ops .btn { width: 100%; max-width: 100%; margin-bottom: .2rem; padding: .3rem .2rem; white-space: nowrap; line-height: 1.2; }
.link-button { padding: 0; border: 0; background: none; color: #0071e3; font: inherit; text-align: left; cursor: pointer; }
.profile-page-head { margin-bottom: .55rem; }
.advanced-entry { margin: .45rem 0; overflow: hidden; border: 1px solid transparent; border-radius: 10px; background: #f6f7f8; }
.advanced-entry summary { display: flex; align-items: center; justify-content: space-between; gap: .45rem; padding: .55rem .65rem; cursor: pointer; list-style: none; }
.advanced-entry summary::-webkit-details-marker { display: none; }
.advanced-entry summary span { display: grid; gap: .08rem; }
.advanced-entry summary strong { color: #1d1d1f; font-size: 12px; }
.advanced-entry summary small { color: #86868b; font-size: 9px; }
.advanced-entry summary em { flex: 0 0 auto; padding: .12rem .38rem; border: 1px solid #dcdde1; border-radius: 6px; background: #f5f5f7; color: #66666c; font-size: 9px; font-style: normal; line-height: 1.3; }
.advanced-entry[open] summary { border-bottom: 1px solid #e5e5ea; background: #f0f7ff; }
.advanced-entry-body { padding: .6rem; background: transparent; }
</style>
