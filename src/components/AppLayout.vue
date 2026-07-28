<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import MapBasemap from './MapBasemap.vue'
import AssistantPanel from './AssistantPanel.vue'
import WorkspaceGuide from './WorkspaceGuide.vue'
import {
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
// right panel state lives in mapShell (shared with map toolbar)
const rightOpen = shellRightOpen
const leftWidth = ref(340)
const userMenuOpen = ref(false)
const searchQ = ref('')
const searchOpen = ref(false)
const searchLoading = ref(false)
const drawerTab = ref<'basic' | 'spatial' | 'relations' | 'status'>('basic')
const detailEditing = ref(false)
const detailLoading = ref(false)
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
  icon: string
  to: string
  defaultTab: string
  children: SubItem[]
}

const centers: CenterItem[] = [
  {
    key: 'tasks',
    label: '任务中心',
    short: '任务中心',
    icon: '任',
    to: '/tasks',
    defaultTab: 'systems',
    children: [
      { key: 'systems', label: '指标体系管理', to: '/tasks', tab: 'systems' },
      { key: 'modeling', label: '手工指标建模', to: '/tasks', tab: 'modeling' },
      { key: 'task-systems', label: '任务指标体系', to: '/tasks', tab: 'task-systems' },
      { key: 'versions', label: '版本与追溯', to: '/tasks', tab: 'versions' },
    ],
  },
  {
    key: 'resources',
    label: '资源中心',
    short: '资源中心',
    icon: '资',
    to: '/resources/sensors',
    defaultTab: 'crud',
    children: [
      { key: 'sensor-types', label: '传感器类型', to: '/resources/sensors', tab: 'types' },
      { key: 'sensors', label: '传感器资源', to: '/resources/sensors', tab: 'crud' },
      { key: 'octuple', label: '传感器详情', to: '/resources/metadata' },
      { key: 'observations', label: '观测数据库', to: '/resources/data', tab: 'query' },
      { key: 'data-sources', label: '数据接入', to: '/resources/data', tab: 'sources' },
      { key: 'algorithms', label: '算法模型与服务', to: '/resources/algorithms', tab: 'models' },
      { key: 'knowledge', label: '知识库', to: '/resources/knowledge' },
    ],
  },
  {
    key: 'business',
    label: '业务中心',
    short: '业务中心',
    icon: '业',
    to: '/business',
    defaultTab: 'tasks',
    children: [
      { key: 'tasks', label: '观测任务管理', to: '/business', tab: 'tasks' },
      { key: 'flow', label: '查选算评配优验', to: '/business', tab: 'flow' },
      { key: 'candidates', label: '候选资源与评分', to: '/business', tab: 'candidates' },
      { key: 'plans', label: '观测方案与评价', to: '/business', tab: 'plans' },
      { key: 'execution', label: '执行与成果', to: '/business/execution' },
    ],
  },
  {
    key: 'application',
    label: '应用中心',
    short: '应用中心',
    icon: '应',
    to: '/application/tasks',
    defaultTab: 'agent-tasks',
    children: [
      { key: 'agent-tasks', label: '场景任务发起', to: '/application/tasks' },
      { key: 'gis', label: 'GIS综合展示', to: '/application', tab: 'gis' },
      { key: 'stats', label: '场景统计分析', to: '/application', tab: 'stats' },
      { key: 'workbench', label: '场景与图层配置', to: '/application', tab: 'workbench' },
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

const activeSubKey = computed(() => {
  const q = String(route.query.tab || '')
  const exact = subItems.value.find((s) => s.to === route.path && (s.tab == null || s.tab === q))
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

// 仅中心路径切换时重载底图业务图层，避免二级菜单切换清空关联线/高亮
watch(
  () => {
    const path = route.path
    const tab = String(route.query.tab || '')
    return path.startsWith('/gis') ? path + '::' + tab : path
  },
  async () => {
    // 切换中心时退出测距/绘制，避免工具状态串台
    try {
      setMapToolMode(shellViewer.value, 'none')
      mapToolMessage.value = ''
      mapDrawGeometry.value = null
    } catch {
      /* optional */
    }
    await reloadShellLayers(route.path, { tab: String(route.query.tab || '') })
  },
  { immediate: true },
)

watch(shellSelected, (v) => {
  detailEditing.value = false
  if (v) {
    openShellRight()
    drawerTab.value = 'basic'
  }
})

const canEditSelected = computed(() => Boolean(user.value && shellSelected.value?.kind !== 'unknown'))
function fieldText(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return value == null ? '' : String(value)
}
function fieldIds(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}
function toDetailOptions(records: Record<string, unknown>[], nameKey = 'name'): DetailOption[] {
  return records.map((record) => {
    const value = fieldText(record, 'id')
    const name = fieldText(record, nameKey) || `#${value}`
    const code = fieldText(record, 'code')
    return { value, label: code ? `${name}（${code}）` : name }
  })
}
async function loadDetailOptions(kind: ShellFeatureKind) {
  if (kind === 'sensor') {
    const response = await api.listPlatformTypes()
    detailOptions.value.platformTypes = toDetailOptions(response.data)
    return
  }
  if (kind === 'data') {
    const [datasets, platforms] = await Promise.all([api.listDatasets(), api.listPlatforms('?pageSize=200')])
    detailOptions.value.datasets = toDetailOptions(datasets.data)
    detailOptions.value.platforms = toDetailOptions(platforms.data)
    return
  }
  if (kind === 'task') {
    const [events, scenes, scales, instances] = await Promise.all([
      api.listEvents(), api.listScenes(), api.listScales(), api.listInstances('?pageSize=200'),
    ])
    detailOptions.value.events = toDetailOptions(events.data)
    detailOptions.value.scenes = toDetailOptions(scenes.data)
    detailOptions.value.scales = toDetailOptions(scales.data)
    detailOptions.value.instances = toDetailOptions(instances.data, 'instanceName')
    return
  }
  if (kind === 'indicator') {
    const [definitions, subThemes, scenes, scales] = await Promise.all([
      api.listDefinitions(), api.listSubThemes(), api.listScenes(), api.listScales(),
    ])
    detailOptions.value.definitions = toDetailOptions(definitions.data)
    detailOptions.value.subThemes = toDetailOptions(subThemes.data)
    detailOptions.value.scenes = toDetailOptions(scenes.data)
    detailOptions.value.scales = toDetailOptions(scales.data)
  }
}
function dateTimeLocal(value: unknown) {
  const text = String(value ?? '')
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text.slice(0, 16)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 19)
}
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

async function beginDetailEdit() {
  const selected = shellSelected.value
  if (!selected || !canEditSelected.value) return
  detailLoading.value = true
  try {
    let record: Record<string, unknown> = {}
    if (selected.kind === 'sensor') record = (await api.getPlatform(selected.id)).data
    else if (selected.kind === 'data') record = (await api.getObservationData(selected.id)).data
    else if (selected.kind === 'task') record = (await api.getTask(selected.id)).data
    else if (selected.kind === 'indicator') record = (await api.getInstance(selected.id)).data
    await loadDetailOptions(selected.kind)
    if (selected.kind === 'sensor') {
      detailEditForm.value = {
        ...emptyDetailEditForm(),
        name: fieldText(record, 'name'),
        platformTypeId: fieldText(record, 'platformTypeId'),
        identifier: fieldText(record, 'identifier'),
        description: fieldText(record, 'description'),
        model: fieldText(record, 'model'),
        manufacturer: fieldText(record, 'manufacturer'),
        userType: fieldText(record, 'userType'),
        owner: fieldText(record, 'owner'),
        status: fieldText(record, 'status'),
      }
    } else if (selected.kind === 'data') {
      detailEditForm.value = {
        ...emptyDetailEditForm(),
        name: fieldText(record, 'name'),
        datasetId: fieldText(record, 'datasetId'),
        platformId: fieldText(record, 'platformId'),
        dataType: fieldText(record, 'dataType'),
        sourceName: fieldText(record, 'sourceName'),
        sourceReference: fieldText(record, 'sourceReference'),
        dataFormat: fieldText(record, 'dataFormat'),
        coordinateSystem: fieldText(record, 'coordinateSystem'),
        timeStart: dateTimeLocal(record.timeStart),
        timeEnd: dateTimeLocal(record.timeEnd),
        qualityStatus: fieldText(record, 'qualityStatus'),
        accessLevel: fieldText(record, 'accessLevel'),
        version: fieldText(record, 'version'),
      }
    } else if (selected.kind === 'task') {
      detailEditForm.value = {
        ...emptyDetailEditForm(),
        name: fieldText(record, 'name'),
        code: fieldText(record, 'code'),
        description: fieldText(record, 'description'),
        observationTarget: fieldText(record, 'observationTarget'),
        priority: fieldText(record, 'priority'),
        taskType: fieldText(record, 'taskType'),
        eventId: fieldText(record, 'eventId'),
        sceneId: fieldText(record, 'sceneId'),
        scaleId: fieldText(record, 'scaleId'),
        timeStart: dateTimeLocal(record.timeStart),
        timeEnd: dateTimeLocal(record.timeEnd),
        resolution: fieldText(record, 'resolution'),
        temporalRes: fieldText(record, 'temporalRes'),
        targetAccuracy: fieldText(record, 'targetAccuracy'),
        maxOptimizeSats: fieldText(record, 'maxOptimizeSats'),
        minCoverageRatio: fieldText(record, 'minCoverageRatio'),
        wTheme: fieldText(record, 'wTheme'),
        wSpace: fieldText(record, 'wSpace'),
        wTime: fieldText(record, 'wTime'),
        wCapability: fieldText(record, 'wCapability'),
        wReliability: fieldText(record, 'wReliability'),
        indicatorInstanceIds: fieldIds(record, 'indicatorInstanceIds'),
      }
    } else {
      detailEditForm.value = {
        ...emptyDetailEditForm(),
        name: fieldText(record, 'instanceName'),
        defId: fieldText(record, 'defId'),
        subThemeId: fieldText(record, 'subThemeId'),
        scaleId: fieldText(record, 'scaleId'),
        sceneId: fieldText(record, 'sceneId'),
        timeStart: dateTimeLocal(record.timeStart),
        timeEnd: dateTimeLocal(record.timeEnd),
        resolution: fieldText(record, 'resolution'),
        temporalRes: fieldText(record, 'temporalRes'),
        targetAccuracy: fieldText(record, 'targetAccuracy'),
        status: fieldText(record, 'status'),
      }
    }
    detailInitialForm.value = {
      ...detailEditForm.value,
      indicatorInstanceIds: [...detailEditForm.value.indicatorInstanceIds],
    }
    detailEditing.value = true
    drawerTab.value = 'basic'
  } catch (error) {
    toast.error(errMessage(error, '无法加载可编辑信息'))
  } finally {
    detailLoading.value = false
  }
}

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
  // drawer open/close changes safe area for bubble and toolbar
  requestAnimationFrame(() => updateShellBubbleScreen())
  setTimeout(() => updateShellBubbleScreen(), 220)
})

function toggleLeft() {
  leftOpen.value = !leftOpen.value
}
function closeRight() {
  closeShellRight()
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

async function jumpSelectedCenter() {
  const s = shellSelected.value
  if (!s) return
  if (s.kind === 'sensor') await router.push({ path: '/resources/sensors', query: { tab: 'crud' } })
  else if (s.kind === 'data') await router.push({ path: '/resources/data', query: { tab: 'query' } })
  else if (s.kind === 'task') await router.push({ path: '/business', query: { tab: 'tasks' } })
  else if (s.kind === 'indicator') await router.push({ path: '/tasks', query: { tab: 'task-systems' } })
  else await router.push({ path: '/resources/algorithms', query: { tab: 'tasks' } })
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
    }"
    :style="{ '--left-w': leftOpen ? leftWidth + 'px' : '0px' }"
  >
    <header class="topbar">
      <div class="topbar-left">
        <span class="brand-mark" aria-hidden="true"></span>
        <button type="button" class="sys-name" title="返回首页" @click="goHome">地学传感网智能感知服务系统</button>
        <span class="topbar-sep">/</span>
        <span class="topbar-center-label">{{ currentCenterLabel }}</span>
        <span class="topbar-sep topbar-page-sep">/</span>
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

    <!-- section -->
    <aside class="left-rail" aria-label="中心导航">
      <button
        v-for="c in centers"
        :key="c.key"
        type="button"
        class="rail-item"
        :class="{ active: activeCenter?.key === c.key }"
        :aria-current="activeCenter?.key === c.key ? 'page' : undefined"
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
      <!-- 详情入口已并入地图工具栏末项，避免与放大等同列叠压 -->
    </main>

    <!-- section -->
    <aside class="detail-drawer" :class="{ open: rightOpen }">
      <div class="drawer-head">
        <div>
          <span class="drawer-kicker">地图对象</span>
          <strong>{{ detailEditing ? '编辑信息' : '对象详情' }}</strong>
        </div>
        <div class="drawer-head-actions">
          <button
            v-if="shellSelected && !detailEditing && canEditSelected"
            type="button"
            class="btn ghost tiny"
            :disabled="detailLoading"
            @click="beginDetailEdit"
          >{{ detailLoading ? '加载中' : '编辑' }}</button>
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
          <div class="drawer-tabs">
            <span :class="{ on: drawerTab === 'basic' }" role="button" tabindex="0" @click="drawerTab = 'basic'">基本信息</span>
            <span :class="{ on: drawerTab === 'spatial' }" role="button" tabindex="0" @click="drawerTab = 'spatial'">空间信息</span>
            <span :class="{ on: drawerTab === 'relations' }" role="button" tabindex="0" @click="drawerTab = 'relations'">关联关系</span>
            <span :class="{ on: drawerTab === 'status' }" role="button" tabindex="0" @click="drawerTab = 'status'">状态</span>
          </div>
          <div class="drawer-meta">{{ kindLabel(shellSelected.kind) }} · ID {{ shellSelected.id }}</div>
          <h3>{{ shellSelected.name }}</h3>
          <pre v-if="drawerTab === 'basic'" class="drawer-pre">{{ shellSelected.description || '暂无描述' }}</pre>
          <div v-else-if="drawerTab === 'spatial'" class="drawer-pre">
            {{ shellSelected.spatial ? '空间位置已加载，可通过地图定位、缩放和图层查看。' : '暂无空间信息，请在对应业务中心使用地图绘制补充。' }}
          </div>
          <pre v-else-if="drawerTab === 'relations'" class="drawer-pre">{{ shellSelected.relations || '暂无关联关系' }}</pre>
          <pre v-else class="drawer-pre">{{ shellSelected.status || '状态未知' }}

{{ shellSelected.description || '' }}</pre>
          <div class="drawer-actions">
            <button type="button" class="btn" @click="jumpSelectedCenter">跳转业务中心</button>
            <button type="button" class="btn ghost" @click="reflySelected">地图定位</button>
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

    <!-- AI assistant -->
    <AssistantPanel v-if="user" />

    <!-- Toast notifications -->
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
