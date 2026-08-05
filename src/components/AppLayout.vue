<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import MapBasemap from './MapBasemap.vue'
import AssistantPanel from './AssistantPanel.vue'
import WorkspaceGuide from './WorkspaceGuide.vue'
import {
  getShellLayerProfile,
  reloadShellLayers,
  selectShellFeature,
  updateShellBubbleScreen,
  shellBubbleOpen,
  shellCounts,
  shellPickScreen,
  shellSelected,
  shellViewer,
  shellRightOpen,
  openShellRight,
  closeShellRight,
  type ShellFeatureKind,
} from '../gis/mapShell'
import { mapToolMessage, setMapToolMode, mapDrawGeometry } from '../gis/mapTools'
import { toasts, dismissToast, toast } from '../utils/toast'
import { errMessage } from '../utils/errors'
import * as api from '../api/endpoints'

const { user, loading, logout } = useAuthStore()
const route = useRoute()
const router = useRouter()

const leftOpen = ref(true)
// 右侧面板状态保存在 mapShell 中，与地图工具栏共享。
const rightOpen = shellRightOpen
const leftWidth = ref(window.innerWidth >= 1440 ? 440 : 360)
watch([leftWidth, leftOpen, rightOpen], ([width, panelOpen, drawerOpen]) => {
  const reservedWidth = panelOpen || drawerOpen ? width : 0
  document.documentElement.style.setProperty('--route-workspace-w', `${reservedWidth}px`)
}, { immediate: true })
const userMenuOpen = ref(false)
const searchQ = ref('')
const searchOpen = ref(false)
const searchLoading = ref(false)
type DrawerTabKey = 'overview' | 'spatial' | 'relations'
const DRAWER_TABS: Array<{ key: DrawerTabKey; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'spatial', label: '空间' },
  { key: 'relations', label: '关联' },
]
const drawerTab = ref<DrawerTabKey>('overview')
const detailEditing = ref(false)
const detailSaving = ref(false)
type DetailEditForm = {
  name: string
  platformTypeId: string
  identifier: string
  description: string
  model: string
  manufacturer: string
  userType: string
  owner: string
  status: string
  datasetId: string
  platformId: string
  dataType: string
  sourceName: string
  sourceReference: string
  dataFormat: string
  coordinateSystem: string
  timeStart: string
  timeEnd: string
  qualityStatus: string
  accessLevel: string
  version: string
  code: string
  observationTarget: string
  priority: string
  taskType: string
  eventId: string
  sceneId: string
  scaleId: string
  resolution: string
  temporalRes: string
  targetAccuracy: string
  maxOptimizeSats: string
  minCoverageRatio: string
  wTheme: string
  wSpace: string
  wTime: string
  wCapability: string
  wReliability: string
  defId: string
  subThemeId: string
  indicatorInstanceIds: string[]
}
function emptyDetailEditForm(): DetailEditForm {
  return {
    name: '', platformTypeId: '', identifier: '', description: '', model: '', manufacturer: '', userType: '', owner: '', status: '',
    datasetId: '', platformId: '', dataType: '', sourceName: '', sourceReference: '', dataFormat: '', coordinateSystem: '',
    timeStart: '', timeEnd: '', qualityStatus: '', accessLevel: '', version: '', code: '', observationTarget: '',
    priority: '', taskType: '', eventId: '', sceneId: '', scaleId: '', resolution: '', temporalRes: '', targetAccuracy: '',
    maxOptimizeSats: '', minCoverageRatio: '', wTheme: '', wSpace: '', wTime: '', wCapability: '', wReliability: '',
    defId: '', subThemeId: '', indicatorInstanceIds: [],
  }
}
const detailEditForm = ref<DetailEditForm>(emptyDetailEditForm())
const detailInitialForm = ref<DetailEditForm>(emptyDetailEditForm())
type DetailOption = { value: string; label: string }
const detailOptions = ref({
  platformTypes: [] as DetailOption[],
  datasets: [] as DetailOption[],
  platforms: [] as DetailOption[],
  events: [] as DetailOption[],
  scenes: [] as DetailOption[],
  scales: [] as DetailOption[],
  definitions: [] as DetailOption[],
  subThemes: [] as DetailOption[],
  instances: [] as DetailOption[],
})
const lastTabByCenter = ref<Record<string, string>>({})

const searchGroups = ref<
  Array<{ type: string; items: Array<{ id: string; title: string; subtitle: string; route: string; tab?: string }> }>
>([])

type SubItem = { key: string; label: string; to: string; tab?: string }
type CenterItem = {
  key: string
  label: string
  short: string
  description: string
  to: string
  defaultTab: string
  children: SubItem[]
}

const centers: CenterItem[] = [
  {
    key: 'tasks',
    label: '任务中心',
    short: '任务中心',
    description: '任务与指标管理',
    to: '/tasks',
    defaultTab: 'task-manage',
    children: [
      { key: 'task-create', label: '任务创建', to: '/tasks', tab: 'task-create' },
      { key: 'task-manage', label: '任务管理', to: '/tasks', tab: 'task-manage' },
      { key: 'indicator-create', label: '指标体系建模', to: '/tasks', tab: 'modeling' },
      { key: 'systems', label: '指标体系管理', to: '/tasks', tab: 'systems' },
      { key: 'versions', label: '指标版本与追溯', to: '/tasks', tab: 'versions' },
    ],
  },
  {
    key: 'resources',
    label: '资源中心',
    short: '资源中心',
    description: '资源与数据管理',
    to: '/resources/sensors',
    defaultTab: 'crud',
    children: [
      { key: 'sensors', label: '传感器资源管理', to: '/resources/sensors', tab: 'crud' },
      { key: 'capabilities', label: '观测能力管理', to: '/resources/sensors', tab: 'capabilities' },
      { key: 'data-modeling', label: '数据资源建模与接入', to: '/resources/data', tab: 'sources' },
      { key: 'observations', label: '观测数据管理', to: '/resources/data', tab: 'query' },
      { key: 'algorithms', label: '算法模型管理', to: '/resources/algorithms', tab: 'models' },
      { key: 'algorithm-services', label: '算法服务管理', to: '/resources/algorithms', tab: 'services' },
      { key: 'knowledge-modeling', label: '知识建模与管理', to: '/resources/knowledge', tab: 'edit' },
      { key: 'knowledge-use', label: '知识检索与应用', to: '/resources/knowledge', tab: 'search' },
    ],
  },
  {
    key: 'business',
    label: '业务中心',
    short: '业务中心',
    description: '任务处理、资源评估与配置',
    to: '/business',
    defaultTab: 'tasks',
    children: [
      { key: 'demand-query', label: '需求查询', to: '/business', tab: 'tasks' },
      { key: 'execution-trace', label: '过程管理与成果追溯', to: '/business/execution' },
      { key: 'resource-selection', label: '资源选择', to: '/business', tab: 'candidates' },
      { key: 'capability-evaluation', label: '能力评估', to: '/business', tab: 'evaluation' },
      { key: 'resource-configuration', label: '资源配置', to: '/business', tab: 'flow' },
      { key: 'plan-management', label: '方案管理', to: '/business', tab: 'plans' },
    ],
  },
  {
    key: 'application',
    label: '应用中心',
    short: '应用中心',
    description: '场景与地图应用',
    to: '/application/tasks',
    defaultTab: 'agent-tasks',
    children: [
      { key: 'workbench', label: '场景主题配置', to: '/application', tab: 'workbench' },
      { key: 'agent-tasks', label: '场景任务发起', to: '/application/tasks' },
      { key: 'gis', label: 'GIS综合展示', to: '/application', tab: 'gis' },
      { key: 'progress', label: '任务进程与成果查看', to: '/business/execution' },
      { key: 'stats', label: '场景统计分析', to: '/application', tab: 'stats' },
    ],
  },
]

const activeCenter = computed(() => {
  if (route.path === '/' || route.name === 'home') return null
  return centers.find((c) => c.children.some((child) => route.path === child.to || route.path.startsWith(child.to + '/'))) || null
})

const currentCenterLabel = computed(() => {
  if (!activeCenter.value) return '首页概览'
  return activeCenter.value.label
})

const pageLabel = computed(() => {
  if (!activeCenter.value) return '运行态势'
  return activeCenter.value.children.find((c) => c.key === activeSubKey.value)?.label || '概览'
})

const subItems = computed(() => activeCenter.value?.children || [])
const sensorProfileId = computed(() =>
  route.path === '/resources/sensors' && typeof route.query.sensorId === 'string'
    ? route.query.sensorId
    : '',
)

const activeSubKey = computed(() => {
  const q = String(route.query.tab || activeCenter.value?.defaultTab || '')
  const exact = subItems.value.find((s) => s.to === route.path && s.tab === q)
    || subItems.value.find((s) => s.to === route.path && s.tab == null)
  if (exact) return exact.key
  const byPath = subItems.value.find((s) => s.to === route.path)
  if (byPath) return byPath.key
  return activeCenter.value?.defaultTab || ''
})

watch(
  () => route.fullPath,
  () => {
    searchOpen.value = false
    userMenuOpen.value = false
    if (activeCenter.value && activeSubKey.value) {
      lastTabByCenter.value[activeCenter.value.key] = activeSubKey.value
    }
  },
)

// 路由只切换业务图层可见性并按需补载；保留 Cesium 实例、视角和已加载的无关图层。
watch(
  () => getShellLayerProfile(route.path, { tab: String(route.query.tab || '') }),
  async () => {
    // 切换中心时退出测距/绘制，避免工具状态串台
    try {
      setMapToolMode(shellViewer.value, 'none')
      mapToolMessage.value = ''
      mapDrawGeometry.value = null
    } catch {
      /* 可选步骤 */
    }
    await reloadShellLayers(
      route.path,
      { tab: String(route.query.tab || '') },
      { preserveExisting: true },
    )
  },
  { immediate: true },
)

watch(
  sensorProfileId,
  (id) => {
    if (id) {
      closeShellRight()
      leftOpen.value = true
    }
  },
  { immediate: true },
)

watch(shellSelected, (v) => {
  detailEditing.value = false
  if (v && shellBubbleOpen.value) {
    openShellRight()
    drawerTab.value = 'overview'
  }
})

function isoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}
function optionalNumber(value: string) {
  return value.trim() === '' ? undefined : Number(value)
}
function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value)
}
function detailFieldChanged(key: keyof DetailEditForm) {
  const current = detailEditForm.value[key]
  const initial = detailInitialForm.value[key]
  return Array.isArray(current) && Array.isArray(initial)
    ? current.join(',') !== initial.join(',')
    : current !== initial
}
function detailPatch(entries: Array<[keyof DetailEditForm, string, unknown]>) {
  const payload: Record<string, unknown> = {}
  for (const [formKey, apiKey, value] of entries) {
    if (detailFieldChanged(formKey)) payload[apiKey] = value
  }
  return payload
}
const detailStatusOptions = computed(() => {
  const kind = shellSelected.value?.kind
  if (kind === 'sensor') {
    const options = [
      { value: 'active', label: '启用' },
      { value: 'inactive', label: '停用' },
    ]
    const current = detailEditForm.value.status
    return current && !options.some((option) => option.value === current)
      ? [{ value: current, label: `当前状态：${current}` }, ...options]
      : options
  }
  if (kind === 'data') return [
    { value: 'unchecked', label: '未检查' },
    { value: 'normal', label: '正常' },
    { value: 'warning', label: '预警' },
    { value: 'anomaly', label: '异常' },
    { value: 'failed', label: '不合格' },
  ]
  if (kind === 'indicator') return [
    { value: 'draft', label: '草稿' },
    { value: 'published', label: '已发布' },
    { value: 'active', label: '启用' },
    { value: 'inactive', label: '停用' },
  ]
  return []
})

async function saveDetailEdit() {
  const selected = shellSelected.value
  const form = detailEditForm.value
  const name = (form.name || '').trim()
  if (!selected || !name) {
    toast.warn('名称不能为空')
    return
  }
  if (selected.kind !== 'sensor') {
    const start = new Date(form.timeStart)
    const end = new Date(form.timeEnd)
    if (!form.timeStart || !form.timeEnd || !Number.isFinite(start.getTime()) || start >= end) {
      toast.warn('结束时间必须晚于开始时间')
      return
    }
  }
  if (selected.kind === 'task') {
    const weights = [form.wTheme, form.wSpace, form.wTime, form.wCapability, form.wReliability].map(Number)
    if (weights.some((value) => !Number.isFinite(value)) || Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 0.001) {
      toast.warn('五项候选评分权重合计必须为 1')
      return
    }
  }
  detailSaving.value = true
  try {
    let payload: Record<string, unknown> = {}
    if (selected.kind === 'sensor') {
      payload = detailPatch([
        ['name', 'name', name],
        ['platformTypeId', 'platformTypeId', Number(form.platformTypeId)],
        ['identifier', 'identifier', form.identifier.trim()],
        ['description', 'description', form.description.trim()],
        ['model', 'model', form.model.trim()],
        ['manufacturer', 'manufacturer', form.manufacturer.trim()],
        ['userType', 'userType', form.userType.trim()],
        ['owner', 'owner', form.owner.trim()],
        ['status', 'status', ['active', 'inactive'].includes(form.status) ? form.status : undefined],
      ])
    } else if (selected.kind === 'data') {
      payload = detailPatch([
        ['name', 'name', name],
        ['datasetId', 'datasetId', Number(form.datasetId)],
        ['platformId', 'platformId', Number(form.platformId)],
        ['dataType', 'dataType', form.dataType.trim()],
        ['sourceName', 'sourceName', form.sourceName.trim()],
        ['sourceReference', 'sourceReference', form.sourceReference.trim()],
        ['dataFormat', 'dataFormat', form.dataFormat.trim()],
        ['coordinateSystem', 'coordinateSystem', form.coordinateSystem.trim()],
        ['timeStart', 'timeStart', isoDateTime(form.timeStart)],
        ['timeEnd', 'timeEnd', isoDateTime(form.timeEnd)],
        ['qualityStatus', 'qualityStatus', form.qualityStatus],
        ['accessLevel', 'accessLevel', form.accessLevel],
        ['version', 'version', Number(form.version)],
      ])
    } else if (selected.kind === 'task') {
      payload = detailPatch([
        ['name', 'name', name],
        ['code', 'code', form.code.trim()],
        ['description', 'description', form.description.trim()],
        ['observationTarget', 'observationTarget', form.observationTarget.trim()],
        ['priority', 'priority', form.priority],
        ['taskType', 'taskType', form.taskType.trim()],
        ['eventId', 'eventId', nullableNumber(form.eventId)],
        ['sceneId', 'sceneId', nullableNumber(form.sceneId)],
        ['scaleId', 'scaleId', nullableNumber(form.scaleId)],
        ['indicatorInstanceIds', 'indicatorInstanceIds', form.indicatorInstanceIds.map(Number)],
        ['timeStart', 'timeStart', isoDateTime(form.timeStart)],
        ['timeEnd', 'timeEnd', isoDateTime(form.timeEnd)],
        ['resolution', 'resolution', nullableNumber(form.resolution)],
        ['temporalRes', 'temporalRes', form.temporalRes.trim()],
        ['targetAccuracy', 'targetAccuracy', optionalNumber(form.targetAccuracy)],
        ['maxOptimizeSats', 'maxOptimizeSats', optionalNumber(form.maxOptimizeSats)],
        ['minCoverageRatio', 'minCoverageRatio', optionalNumber(form.minCoverageRatio)],
        ['wTheme', 'wTheme', optionalNumber(form.wTheme)],
        ['wSpace', 'wSpace', optionalNumber(form.wSpace)],
        ['wTime', 'wTime', optionalNumber(form.wTime)],
        ['wCapability', 'wCapability', optionalNumber(form.wCapability)],
        ['wReliability', 'wReliability', optionalNumber(form.wReliability)],
      ])
    } else if (selected.kind === 'indicator') {
      payload = detailPatch([
        ['name', 'instanceName', name],
        ['defId', 'defId', Number(form.defId)],
        ['subThemeId', 'subThemeId', nullableNumber(form.subThemeId)],
        ['scaleId', 'scaleId', Number(form.scaleId)],
        ['sceneId', 'sceneId', nullableNumber(form.sceneId)],
        ['timeStart', 'timeStart', isoDateTime(form.timeStart)],
        ['timeEnd', 'timeEnd', isoDateTime(form.timeEnd)],
        ['resolution', 'resolution', Number(form.resolution)],
        ['temporalRes', 'temporalRes', form.temporalRes.trim()],
        ['targetAccuracy', 'targetAccuracy', optionalNumber(form.targetAccuracy)],
        ['status', 'status', form.status],
      ])
    }
    if (!Object.keys(payload).length) {
      detailEditing.value = false
      toast.info('信息未发生变化')
      return
    }
    if (selected.kind === 'sensor') await api.updatePlatform(selected.id, payload)
    else if (selected.kind === 'data') await api.updateObservationData(selected.id, payload)
    else if (selected.kind === 'task') await api.updateTask(selected.id, payload)
    else if (selected.kind === 'indicator') await api.updateInstance(selected.id, payload)
    detailEditing.value = false
    await reloadShellLayers(route.path, { tab: String(route.query.tab || '') })
    await selectShellFeature(selected.kind, selected.id, { openBubble: true, fly: false })
    toast.success('信息已保存并同步到地图')
  } catch (error) {
    toast.error(errMessage(error, '保存失败'))
  } finally {
    detailSaving.value = false
  }
}

watch(rightOpen, () => {
  // 抽屉开关会改变气泡和工具栏的安全区域。
  requestAnimationFrame(() => updateShellBubbleScreen())
  setTimeout(() => updateShellBubbleScreen(), 220)
})

function toggleLeft() {
  leftOpen.value = !leftOpen.value
}
async function closeRight() {
  closeShellRight()
}

function onLeftResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = leftWidth.value
  function move(e: MouseEvent) {
    leftWidth.value = Math.min(520, Math.max(320, startW - (e.clientX - startX)))
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
  const key = lastTabByCenter.value[c.key] || c.defaultTab
  const child = c.children.find((item) => item.key === key) || c.children[0]
  if (!child) return
  await router.push({ path: child.to, query: child.tab ? { tab: child.tab } : {} })
}

async function goSub(key: string) {
  if (!activeCenter.value) return
  const child = activeCenter.value.children.find((item) => item.key === key)
  if (!child) return
  await router.push({ path: child.to, query: child.tab ? { tab: child.tab } : {} })
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

type DrawerDetailRow = { label: string; value: string }

const detailLabelMap: Record<string, string> = {
  platformId: '平台 ID',
  taskId: '任务 ID',
  instanceId: '指标实例 ID',
  sensorId: '传感器 ID',
  identifier: '资源标识',
  '平台ID': '平台 ID',
  '任务ID': '任务 ID',
  '数据ID': '数据 ID',
  '实例ID': '实例 ID',
  '定义ID': '定义 ID',
  '指标实例ID': '指标实例 ID',
}

function detailRows(value: unknown): DrawerDetailRow[] {
  const valueLabels: Record<string, string> = {
    manual: '人工规划',
    monitoring: '持续监测',
    assistant: 'AI 助手创建',
  }
  const seen = new Set<string>()
  const rows: DrawerDetailRow[] = []
  for (const rawLine of String(value || '').replace(/<br\s*\/?>/gi, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const matched = line.match(/^([^:：]{1,24})[:：]\s*(.*)$/)
    const rawLabel = matched?.[1]?.trim() || '说明'
    const label = detailLabelMap[rawLabel] || rawLabel
    const rawValue = matched?.[2]?.trim() || line
    const fieldValue = label === '类型' ? valueLabels[rawValue.toLowerCase()] || rawValue : rawValue
    if (!fieldValue || /wkt|geometry/i.test(label)) continue
    const key = `${label}:${fieldValue}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ label, value: fieldValue })
  }
  return rows
}

const drawerStatusText = computed(() => {
  const raw = String(shellSelected.value?.status || '').trim()
  const labels: Record<string, string> = {
    active: '启用',
    enabled: '启用',
    online: '在线',
    normal: '正常',
    submitted: '已提交',
    published: '已发布',
    completed: '已完成',
    complete: '已完成',
    finished: '已完成',
    draft: '草稿',
    created: '已创建',
    unchecked: '未检查',
    warning: '预警',
    anomaly: '异常',
    inactive: '停用',
    offline: '离线',
    failed: '失败',
    fault: '故障',
    cancelled: '已取消',
  }
  return labels[raw.toLowerCase()] || raw || '状态未知'
})

const drawerStatusTone = computed(() => {
  const status = String(shellSelected.value?.status || '').toLowerCase()
  if (/fail|fault|error|anomaly|异常|故障|失败|cancel/.test(status)) return 'danger'
  if (/warning|warn|offline|inactive|unchecked|维护|预警|离线|停用|未检查/.test(status)) return 'warning'
  if (/active|enabled|online|normal|submitted|published|complete|finished|启用|在线|正常|提交|发布|完成/.test(status)) return 'success'
  return 'neutral'
})

const drawerOverviewRows = computed(() => {
  const hiddenLabels = /^(状态|质量|位置|空间位置|空间范围|任务区域|覆盖范围)$/
  return detailRows(shellSelected.value?.description).filter((row) => !hiddenLabels.test(row.label))
})

const drawerRelationRows = computed(() => {
  const hiddenLabels = /^(状态|质量|位置|空间位置|空间范围|任务区域|覆盖范围)$/
  return detailRows(shellSelected.value?.relations).filter((row) => !hiddenLabels.test(row.label))
})

const drawerSpatialReady = computed(() => Boolean(String(shellSelected.value?.spatial || '').trim()))

const selectedCenterActionLabel = computed(() => {
  const kind = shellSelected.value?.kind
  if (kind === 'sensor') return '打开资源管理'
  if (kind === 'data') return '打开数据管理'
  if (kind === 'task') return '打开任务规划'
  if (kind === 'indicator') return '打开指标配置'
  return '打开业务页面'
})

function setDrawerTab(tab: DrawerTabKey) {
  drawerTab.value = tab
}

function onDrawerTabKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  let targetIndex = index
  if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = DRAWER_TABS.length - 1
  else if (event.key === 'ArrowLeft') targetIndex = (index - 1 + DRAWER_TABS.length) % DRAWER_TABS.length
  else targetIndex = (index + 1) % DRAWER_TABS.length
  const target = DRAWER_TABS[targetIndex]
  if (!target) return
  setDrawerTab(target.key)
  requestAnimationFrame(() => document.getElementById(`drawer-tab-${target.key}`)?.focus())
}

async function jumpSelectedCenter() {
  const s = shellSelected.value
  if (!s) return
  closeShellRight()
  leftOpen.value = true
  const returnContext = route.path === '/application/tasks' && route.query.runId
    ? {
        runId: String(route.query.runId),
        returnTo: '/application/tasks',
        currentTab: String(route.query.tab || 'overview'),
      }
    : {}
  if (s.kind === 'sensor') await router.push({ path: '/resources/sensors', query: { tab: 'crud', ...returnContext } })
  else if (s.kind === 'data') await router.push({ path: '/resources/data', query: { tab: 'query', ...returnContext } })
  else if (s.kind === 'task') await router.push({ path: '/business', query: { tab: 'tasks', ...returnContext } })
  else if (s.kind === 'indicator') await router.push({ path: '/tasks', query: { tab: 'task-systems', ...returnContext } })
  else await router.push({ path: '/resources/algorithms', query: { tab: 'tasks', ...returnContext } })
}

function sensorDrawerContext() {
  const returnContext = route.path === '/application/tasks' && route.query.runId
    ? { runId: String(route.query.runId), returnTo: '/application/tasks', currentTab: String(route.query.tab || 'overview') }
    : {}
  return { ...returnContext, sensorId: String(shellSelected.value?.id || '') }
}

async function openSelectedSensorArchive(section: 'general' | 'attributes', targetTab: 'crud' | 'capabilities' = 'crud') {
  const sensor = shellSelected.value
  if (!sensor || sensor.kind !== 'sensor') return
  closeShellRight()
  leftOpen.value = true
  await router.push({
    path: '/resources/sensors',
    query: { tab: targetTab, section, mode: 'edit', ...sensorDrawerContext() },
  })
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
    openShellRight()
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
    const qstr = `?keyword=${encodeURIComponent(q)}`
    const [sensors, data, tasks, instances] = await Promise.allSettled([
      api.listPlatforms(qstr),
      api.listObservationData(qstr),
      api.listTasks(),
      api.listInstances(qstr),
    ])

    function rows(r: PromiseSettledResult<any>): any[] {
      if (r.status !== 'fulfilled') return []
      const v = r.value as any
      const candidates = [v, v?.data, v?.data?.records, v?.data?.results, v?.data?.items, v?.results, v?.records]
      for (const c of candidates) {
        if (Array.isArray(c)) return c
      }
      return []
    }

    const sensorItems = rows(sensors)
      .slice(0, 8)
      .map((x: any) => ({
        id: String(x.id ?? x.platformId ?? x.platform_id ?? ''),
        title: String(x.name || x.platformName || x.identifier || `平台 #${x.id}`),
        subtitle: String(x.platformTypeCode || x.status || '平台'),
        route: '/resources/sensors',
        tab: 'crud',
      }))
    if (sensorItems.length) groups.push({ type: '传感器', items: sensorItems })

    const dataItems = rows(data)
      .slice(0, 8)
      .map((x: any) => ({
        id: String(x.id),
        title: String(x.name || x.dataName || `监测数据 #${x.id}`),
        subtitle: String(x.qualityStatus || x.dataType || '监测数据'),
        route: '/resources/data',
        tab: 'query',
      }))
    if (dataItems.length) groups.push({ type: '监测数据', items: dataItems })

    const taskItems = rows(tasks)
      .filter((x: any) => {
        const hay = `${x.name || ''} ${x.taskName || ''} ${x.code || ''} ${x.id || ''}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .slice(0, 8)
      .map((x: any) => ({
        id: String(x.id),
        title: String(x.name || x.taskName || `观测任务 #${x.id}`),
        subtitle: String(x.status || '观测任务'),
        route: '/business',
        tab: 'tasks',
      }))
    if (taskItems.length) groups.push({ type: '观测任务', items: taskItems })

    const indItems = rows(instances)
      .slice(0, 8)
      .map((x: any) => ({
        id: String(x.id),
        title: String(x.name || x.instanceName || `指标实例 #${x.id}`),
        subtitle: String(x.status || '指标实例'),
        route: '/tasks',
        tab: 'task-systems',
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
  await new Promise((r) => setTimeout(r, 150))
  let ok = false
  if (item.route === '/resources/sensors') ok = await selectShellFeature('sensor', item.id, { openBubble: true, fly: true })
  else if (item.route === '/resources/data') ok = await selectShellFeature('data', item.id, { openBubble: true, fly: true })
  else if (item.route === '/business') ok = await selectShellFeature('task', item.id, { openBubble: true, fly: true })
  else if (item.route === '/tasks') ok = await selectShellFeature('indicator', item.id, { openBubble: true, fly: true })
  openShellRight()
  if (!ok && item.id) {
    const kind =
      item.route === '/resources/sensors'
        ? 'sensor'
        : item.route === '/resources/data'
          ? 'data'
          : item.route === '/business'
            ? 'task'
            : item.route === '/tasks'
              ? 'indicator'
              : 'unknown'
    shellSelected.value = {
      kind: kind as any,
      id: item.id,
      name: item.title,
      description: item.subtitle || ('ID: ' + item.id),
      status: item.subtitle || '',
      spatial: '',
      relations: '',
    }
  }
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
      'workspace-open': leftOpen && !rightOpen,
    }"
    :style="{ '--left-w': leftOpen ? leftWidth + 'px' : '0px', '--drawer-w': leftWidth + 'px' }"
  >
    <header class="topbar">
      <div class="topbar-left">
        <span class="brand-mark" aria-hidden="true"></span>
        <button type="button" class="sys-name" title="返回首页" @click="goHome">地学传感网智能感知服务系统</button>
        <template v-if="!leftOpen">
          <span class="topbar-sep">/</span>
          <span class="topbar-page">{{ currentCenterLabel }} · {{ pageLabel }}</span>
        </template>
      </div>

      <div class="topbar-search">
        <button
          type="button"
          class="topbar-search-btn"
          :class="{ loading: searchLoading }"
          :disabled="searchLoading"
          title="搜索"
          aria-label="搜索"
          @click="runSearch"
        >
          <span aria-hidden="true"></span>
        </button>
        <input
          v-model="searchQ"
          type="search"
          placeholder="搜索地点、指标、传感器、任务、方案或数据"
          @keydown.enter="runSearch"
          @focus="searchOpen = searchGroups.length > 0"
        />
        <div v-if="searchOpen" class="search-pop">
          <div class="search-pop-scroll">
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
      </div>

      <div class="topbar-right">
        <WorkspaceGuide v-if="user" />
        <div v-if="user" class="user-menu-wrap">
          <button
            type="button"
            class="user-menu-trigger"
            aria-haspopup="menu"
            :aria-expanded="userMenuOpen"
            @click="userMenuOpen = !userMenuOpen"
          >
            <span class="user-avatar" aria-hidden="true">{{ user.username.slice(0, 1).toUpperCase() }}</span>
            <span class="user-menu-copy">
              <strong>{{ user.username }}</strong>
              <small>已登录</small>
            </span>
            <span class="user-chevron" aria-hidden="true">⌄</span>
          </button>
          <div v-if="userMenuOpen" class="user-menu" role="menu">
            <button type="button" class="user-menu-item" role="menuitem" @click="doLogout">退出登录</button>
          </div>
        </div>
        <span v-else-if="loading" class="user-chip">加载中</span>
        <RouterLink v-else to="/login" class="btn ghost tiny">登录</RouterLink>
      </div>
    </header>

    <!-- 区块 -->
    <aside class="left-rail" aria-label="中心导航">
      <div v-for="c in centers" :key="c.key" class="rail-group">
        <button
          type="button"
          class="rail-item"
          :class="{ active: activeCenter?.key === c.key }"
          :aria-expanded="activeCenter?.key === c.key"
          :title="c.label"
          @click="goCenter(c)"
        >
          <span class="rail-dot" aria-hidden="true"></span>
          <span class="rail-copy">
            <strong>{{ c.short }}</strong>
            <small>{{ c.description }}</small>
          </span>
          <span class="rail-chevron" aria-hidden="true">›</span>
        </button>

        <div v-if="activeCenter?.key === c.key" class="rail-subnav" :aria-label="c.label + '功能'">
          <button
            v-for="s in c.children"
            :key="s.key"
            type="button"
            class="rail-subitem"
            :class="{ active: activeSubKey === s.key }"
            :aria-current="activeSubKey === s.key ? 'page' : undefined"
            @click="goSub(s.key)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
    </aside>

    <!-- 区块 -->
    <aside v-show="leftOpen" class="left-panel" :style="{ width: leftWidth + 'px' }">
      <div class="left-panel-head">
        <span>{{ pageLabel }}</span>
        <button type="button" class="btn ghost tiny" @click="toggleLeft">收起面板</button>
      </div>

      <div class="left-body">
        <RouterView />
      </div>
      <div class="panel-resizer" title="拖动调整宽度" @mousedown.prevent="onLeftResize" />
    </aside>

    <!-- 区块 -->
    <main class="map-main">
      <MapBasemap />
      <button v-if="!leftOpen" type="button" class="edge-btn left" @click="toggleLeft">展开</button>
      <!-- 详情入口已并入地图工具栏末项，避免与放大等同列叠压 -->
    </main>

    <!-- 区块 -->
    <aside class="detail-drawer" :class="{ open: rightOpen }">
      <div class="drawer-head">
        <div>
          <span class="drawer-kicker">地图对象详情</span>
          <strong>
            <template v-if="shellSelected">{{ detailEditing ? `编辑${kindLabel(shellSelected.kind)}` : kindLabel(shellSelected.kind) }}</template>
            <template v-else>对象详情</template>
          </strong>
        </div>
        <div class="drawer-head-actions">
          <button type="button" class="icon-btn drawer-close" title="关闭详情" aria-label="关闭详情" @click="closeRight">×</button>
        </div>
      </div>
      <div class="drawer-body">
        <template v-if="shellSelected">
          <form v-if="detailEditing" class="drawer-edit-form" @submit.prevent="saveDetailEdit">
            <div class="drawer-edit-context">
              <span>{{ kindLabel(shellSelected.kind) }}</span>
              <small>ID {{ shellSelected.id }}</small>
            </div>
            <section class="drawer-form-section">
              <h4>基础信息</h4>
              <div class="drawer-form-grid">
                <label class="wide"><span>名称</span><input v-model.trim="detailEditForm.name" required maxlength="200" /></label>
                <template v-if="shellSelected.kind === 'sensor'">
                  <label><span>资源类型</span><select v-model="detailEditForm.platformTypeId" required><option v-for="option in detailOptions.platformTypes" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>资源标识</span><input v-model.trim="detailEditForm.identifier" maxlength="100" /></label>
                  <label><span>使用状态</span><select v-model="detailEditForm.status"><option v-for="option in detailStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>设备型号</span><input v-model.trim="detailEditForm.model" /></label>
                  <label><span>生产厂家</span><input v-model.trim="detailEditForm.manufacturer" /></label>
                  <label><span>用户类型</span><input v-model.trim="detailEditForm.userType" /></label>
                  <label><span>所属单位</span><input v-model.trim="detailEditForm.owner" /></label>
                  <label class="wide"><span>资源描述</span><textarea v-model.trim="detailEditForm.description" rows="4" maxlength="1000"></textarea></label>
                </template>
                <template v-else-if="shellSelected.kind === 'data'">
                  <label><span>所属数据集</span><select v-model="detailEditForm.datasetId" required><option v-for="option in detailOptions.datasets" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>来源平台</span><select v-model="detailEditForm.platformId" required><option v-for="option in detailOptions.platforms" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>数据类型</span><input v-model.trim="detailEditForm.dataType" required /></label>
                  <label><span>数据格式</span><input v-model.trim="detailEditForm.dataFormat" required /></label>
                  <label><span>质量状态</span><select v-model="detailEditForm.qualityStatus"><option v-for="option in detailStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>访问级别</span><select v-model="detailEditForm.accessLevel"><option value="public">公开</option><option value="restricted">受限</option></select></label>
                  <label><span>版本</span><input v-model="detailEditForm.version" type="number" min="1" required /></label>
                </template>
                <template v-else-if="shellSelected.kind === 'task'">
                  <label><span>任务编码</span><input v-model.trim="detailEditForm.code" maxlength="100" /></label>
                  <label><span>任务类型</span><select v-model="detailEditForm.taskType"><option value="manual">人工规划</option><option value="monitoring">持续监测</option><option value="assistant">AI 助手创建</option></select></label>
                  <label><span>优先级</span><select v-model="detailEditForm.priority"><option value="high">高</option><option value="normal">常规</option><option value="low">低</option></select></label>
                  <label><span>所属事件</span><select v-model="detailEditForm.eventId"><option value="">不关联事件</option><option v-for="option in detailOptions.events" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label class="wide"><span>观测目标</span><input v-model.trim="detailEditForm.observationTarget" /></label>
                  <label class="wide"><span>任务描述</span><textarea v-model.trim="detailEditForm.description" rows="4"></textarea></label>
                  <label class="wide"><span>关联指标实例</span><select v-model="detailEditForm.indicatorInstanceIds" class="drawer-multi-select" multiple><option v-for="option in detailOptions.instances" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                </template>
                <template v-else>
                  <label><span>指标定义</span><select v-model="detailEditForm.defId" required><option v-for="option in detailOptions.definitions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>子主题</span><select v-model="detailEditForm.subThemeId"><option value="">不指定子主题</option><option v-for="option in detailOptions.subThemes" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  <label><span>使用状态</span><select v-model="detailEditForm.status"><option v-for="option in detailStatusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                </template>
              </div>
            </section>

            <section v-if="shellSelected.kind === 'data'" class="drawer-form-section">
              <h4>来源与时空</h4>
              <div class="drawer-form-grid">
                <label><span>来源名称</span><input v-model.trim="detailEditForm.sourceName" required /></label>
                <label><span>坐标系</span><input v-model.trim="detailEditForm.coordinateSystem" placeholder="例如 EPSG:4326" /></label>
                <label class="wide"><span>来源引用</span><input v-model.trim="detailEditForm.sourceReference" maxlength="500" /></label>
                <label><span>开始时间</span><input v-model="detailEditForm.timeStart" type="datetime-local" step="1" required /></label>
                <label><span>结束时间</span><input v-model="detailEditForm.timeEnd" type="datetime-local" step="1" required /></label>
              </div>
              <p class="drawer-edit-note">数据授权用户和用户组请在观测数据中心的授权管理中修改，避免在通用详情中误改访问权限。</p>
            </section>

            <section v-if="shellSelected.kind === 'task' || shellSelected.kind === 'indicator'" class="drawer-form-section">
              <h4>时空与精度</h4>
              <div class="drawer-form-grid">
                <label><span>业务场景</span><select v-model="detailEditForm.sceneId"><option value="">不指定场景</option><option v-for="option in detailOptions.scenes" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>观测尺度</span><select v-model="detailEditForm.scaleId" :required="shellSelected.kind === 'indicator'"><option v-if="shellSelected.kind === 'task'" value="">不指定尺度</option><option v-for="option in detailOptions.scales" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label><span>开始时间</span><input v-model="detailEditForm.timeStart" type="datetime-local" step="1" required /></label>
                <label><span>结束时间</span><input v-model="detailEditForm.timeEnd" type="datetime-local" step="1" required /></label>
                <label><span>空间分辨率</span><input v-model="detailEditForm.resolution" type="number" step="any" min="0" :required="shellSelected.kind === 'indicator'" /></label>
                <label><span>时间分辨率</span><input v-model.trim="detailEditForm.temporalRes" /></label>
                <label><span>目标精度 %</span><input v-model="detailEditForm.targetAccuracy" type="number" step="any" min="0" max="100" /></label>
                <template v-if="shellSelected.kind === 'task'">
                  <label><span>最大优化资源数</span><input v-model="detailEditForm.maxOptimizeSats" type="number" min="1" /></label>
                  <label><span>最低覆盖比例</span><input v-model="detailEditForm.minCoverageRatio" type="number" step="any" min="0" max="1" /></label>
                </template>
              </div>
            </section>

            <section v-if="shellSelected.kind === 'task'" class="drawer-form-section">
              <h4>候选评分权重</h4>
              <div class="drawer-form-grid weights">
                <label><span>主题</span><input v-model="detailEditForm.wTheme" type="number" step="0.01" min="0" max="1" /></label>
                <label><span>空间</span><input v-model="detailEditForm.wSpace" type="number" step="0.01" min="0" max="1" /></label>
                <label><span>时间</span><input v-model="detailEditForm.wTime" type="number" step="0.01" min="0" max="1" /></label>
                <label><span>能力</span><input v-model="detailEditForm.wCapability" type="number" step="0.01" min="0" max="1" /></label>
                <label><span>可靠性</span><input v-model="detailEditForm.wReliability" type="number" step="0.01" min="0" max="1" /></label>
              </div>
              <p class="drawer-edit-note">五项权重合计必须为 1；任务状态仍在规划流程中提交或取消。</p>
            </section>
            <p class="drawer-edit-note">空间范围请使用地图绘制与业务中心工具修改，避免手工输入坐标造成无效几何。</p>
            <div class="drawer-edit-actions">
              <button type="button" class="btn ghost" :disabled="detailSaving" @click="detailEditing = false">取消</button>
              <button type="button" class="btn" :disabled="detailSaving" @click="saveDetailEdit">{{ detailSaving ? '保存中…' : '保存修改' }}</button>
            </div>
          </form>
          <template v-else>
            <div class="drawer-view">
              <section class="drawer-summary" aria-labelledby="drawer-object-name">
                <div class="drawer-summary-top">
                  <div class="drawer-object-identity">
                    <span class="drawer-object-mark" aria-hidden="true">{{ kindLabel(shellSelected.kind).slice(0, 1) }}</span>
                    <div>
                      <span class="drawer-meta">{{ kindLabel(shellSelected.kind) }} · ID {{ shellSelected.id }}</span>
                      <h2 id="drawer-object-name">{{ shellSelected.name }}</h2>
                    </div>
                  </div>
                  <span class="drawer-status" :class="drawerStatusTone">
                    <i aria-hidden="true"></i>{{ drawerStatusText }}
                  </span>
                </div>
                <div class="drawer-summary-facts">
                  <span><small>空间</small><strong>{{ drawerSpatialReady ? '已加载' : '未配置' }}</strong></span>
                  <span><small>关联</small><strong>{{ drawerRelationRows.length ? '已记录' : '暂无' }}</strong></span>
                </div>
              </section>

              <div class="drawer-tabs" role="tablist" aria-label="对象详情分类">
                <button
                  v-for="(item, index) in DRAWER_TABS"
                  :id="`drawer-tab-${item.key}`"
                  :key="item.key"
                  type="button"
                  role="tab"
                  :class="{ on: drawerTab === item.key }"
                  :aria-selected="drawerTab === item.key"
                  :aria-controls="`drawer-panel-${item.key}`"
                  :tabindex="drawerTab === item.key ? 0 : -1"
                  @click="setDrawerTab(item.key)"
                  @keydown="onDrawerTabKeydown($event, index)"
                >{{ item.label }}</button>
              </div>

              <section
                v-if="drawerTab === 'overview'"
                id="drawer-panel-overview"
                class="drawer-tab-panel"
                role="tabpanel"
                aria-labelledby="drawer-tab-overview"
              >
                <h3>对象信息</h3>
                <dl v-if="drawerOverviewRows.length" class="drawer-detail-list">
                  <div v-for="row in drawerOverviewRows" :key="`${row.label}-${row.value}`">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl>
                <p v-else class="drawer-empty-state">暂未提供可展示的对象信息。</p>
              </section>

              <section
                v-else-if="drawerTab === 'spatial'"
                id="drawer-panel-spatial"
                class="drawer-tab-panel"
                role="tabpanel"
                aria-labelledby="drawer-tab-spatial"
              >
                <h3>空间信息</h3>
                <div class="drawer-spatial-state" :class="{ ready: drawerSpatialReady }">
                  <strong>{{ drawerSpatialReady ? '空间位置已加载' : '暂未配置空间位置' }}</strong>
                  <p>{{ drawerSpatialReady ? '当前对象已在地图中选中，可使用下方按钮重新定位。' : '请进入对应业务页面，使用地图绘制或位置配置补充。' }}</p>
                </div>
                <dl class="drawer-detail-list">
                  <div><dt>地图状态</dt><dd>{{ drawerSpatialReady ? '已选中并高亮' : '无可定位范围' }}</dd></div>
                  <div><dt>查看方式</dt><dd>缩放地图或切换业务图层</dd></div>
                </dl>
              </section>

              <section
                v-else
                id="drawer-panel-relations"
                class="drawer-tab-panel"
                role="tabpanel"
                aria-labelledby="drawer-tab-relations"
              >
                <h3>关联信息</h3>
                <dl v-if="drawerRelationRows.length" class="drawer-detail-list">
                  <div v-for="row in drawerRelationRows" :key="`${row.label}-${row.value}`">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl>
                <p v-else class="drawer-empty-state">当前对象暂无关联记录。</p>
              </section>

              <div v-if="shellSelected.kind === 'sensor'" class="drawer-sensor-actions" aria-label="传感器档案操作">
                <button type="button" class="btn ghost" @click="openSelectedSensorArchive('general', 'crud')">编辑基础信息</button>
                <button type="button" class="btn ghost" @click="openSelectedSensorArchive('attributes', 'capabilities')">编辑观测能力</button>
                <button type="button" class="btn ghost" @click="openSelectedSensorArchive('general', 'crud')">维护完整档案</button>
              </div>
              <div class="drawer-actions">
                <button type="button" class="btn ghost" @click="jumpSelectedCenter">{{ selectedCenterActionLabel }}</button>
                <button type="button" class="btn" :disabled="!drawerSpatialReady" @click="reflySelected">地图定位</button>
              </div>
            </div>
          </template>
        </template>
        <template v-else>
          <p class="muted">点击地图对象或列表记录后在此显示详情与操作</p>
          <p class="hint">
            传感器 {{ shellCounts.sensors }} / 数据 {{ shellCounts.data }} / 任务 {{ shellCounts.tasks }}
          </p>
        </template>
      </div>
    </aside>

    <!-- AI 助手 -->
    <AssistantPanel v-if="user" />

    <!-- Toast 提示 -->
    <Teleport to="body">
      <div class="toast-rack" aria-live="polite">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="toast-item"
          :class="'toast-' + t.level"
          role="alert"
        >
          <span class="toast-msg">{{ t.message }}</span>
          <button type="button" class="toast-close" @click="dismissToast(t.id)" aria-label="关闭通知">&times;</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
