<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import ContextGuide from '../components/ContextGuide.vue'
import { errMessage } from '../utils/errors'
import { tablePager as vTablePager } from '../utils/tablePager'

type Row = Record<string, any>

const props = withDefaults(defineProps<{ sensorId?: string; embedded?: boolean }>(), {
  sensorId: '',
  embedded: false,
})
const route = useRoute()
const router = useRouter()
const sensors = ref<Row[]>([])
const selectedId = ref('')
const detail = ref<Row | null>(null)
const tab = ref('general')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const draft = ref<Row>({})
const draftBaseline = ref('')
const historyDraft = ref({ eventType: 'maintenance', occurredAt: '', description: '' })
const measurementDraft = ref({ id: '', code: '', name: '', unit: '', parametersText: '{}' })
const editingMeasurementId = ref('')
const measurementEditorOpen = ref(false)
const historyPage = ref(1)
const historyPageSize = 4
const capabilityAdvancedJson = ref('{}')
const constraintJson = ref<Record<string, string>>({})
const interfaceDraft = ref({
  id: '', interfaceType: 'observation', name: '', endpoint: '', protocol: '', dataFormat: '',
  authMethod: 'none', credentialReference: '', serviceStatus: 'unknown', metadataText: '{}',
})
const editingInterfaceId = ref('')
const interfaceEditorOpen = ref(false)
const revisitCycleValue = ref('')
const revisitCycleUnit = ref('秒')

const tabs: Array<[string, string]> = [
  ['general', '传感器基础信息'],
  ['attributes', '传感器观测能力'],
  ['spatiotemporal', '时空有效性'],
  ['geographic', '空间位置'],
  ['history', '运行履历'],
  ['contact', '责任联系'],
  ['constraints', '使用约束'],
  ['interfaces', '接入接口'],
]
const tabBriefs: Record<string, string> = {
  general: '名称、平台、标识和启停状态',
  attributes: '感知原理、量测项、分辨率和精度',
  spatiotemporal: '有效时间、坐标和重访周期',
  geographic: '位置、覆盖范围、轨迹和姿态',
  history: '部署、校准、维护和故障记录',
  contact: '责任单位、人员和联系方式',
  constraints: '环境、权限、共享、安全、成本和调度',
  interfaces: '观测接口、格式、认证和服务状态',
}
const metadataGuideSteps = [
  { title: '从资源列表进入', detail: '先确认当前传感器及所属平台，再进入传感器完整档案。' },
  { title: '优先维护观测能力', detail: '量测项、分辨率、精度和覆盖范围会直接影响候选筛选与方案评价。' },
  { title: '有真实资料再补充', detail: '运行履历、责任联系、使用约束和接入接口可按实际资料逐项保存。' },
]
const filteredSensors = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return sensors.value.filter((item) => !q || `${item.sensorName || item.name || ''} ${item.platformName || ''}`.toLowerCase().includes(q))
})
const historyItems = computed(() => rows(detail.value?.history))
const historyPageCount = computed(() => Math.max(1, Math.ceil(historyItems.value.length / historyPageSize)))
const pagedHistoryItems = computed(() => historyItems.value.slice(
  (historyPage.value - 1) * historyPageSize,
  historyPage.value * historyPageSize,
))
const historyPageLabels = computed(() => Array.from(
  { length: historyPageCount.value },
  (_, index) => `运行履历第 ${index + 1} 页`,
))
const currentTabBrief = computed(() => tabBriefs[tab.value] || '')
const profileCompleteness = computed(() => detail.value?.profileCompleteness || null)
const requestedMode = computed(() => String(route.query.mode || 'view') === 'edit' ? 'edit' : 'view')
const currentSectionPermission = computed(() => {
  const permissions = detail.value?.permissions || {}
  if (tab.value === 'attributes') return permissions.canEditCapabilities !== false
  if (tab.value === 'constraints' || tab.value === 'interfaces') return permissions.canEditInterfacesAndConstraints !== false
  return permissions.canEditGeneral !== false
})
const archiveMode = computed(() => requestedMode.value === 'view' || !currentSectionPermission.value)
const completedSectionCount = computed(() => Number(profileCompleteness.value?.completedCount ?? 0))
const profileRatio = computed(() => Number(profileCompleteness.value?.ratio ?? 0))
const currentSectionDirty = computed(() => draftSnapshot() !== draftBaseline.value)
const sectionStatus = computed(() => {
  const item = profileCompleteness.value?.sections?.find((section: Row) => section.key === tab.value)
  return item?.status || 'incomplete'
})

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value ?? {})) }
function isSectionComplete(key: string) {
  const section = profileCompleteness.value?.sections?.find((item: Row) => item.key === key)
  return section?.status === 'complete' || section?.complete === true
}
function sectionFromQuery(value: unknown) {
  const raw = String(value || '')
  if (raw === 'basic') return 'general'
  if (raw === 'capability') return 'attributes'
  return tabs.some(([key]) => key === raw) ? raw : 'general'
}
function toDateTimeLocal(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function draftSnapshot() {
  return JSON.stringify({
    draft: draft.value,
    capabilityAdvancedJson: capabilityAdvancedJson.value,
    constraintJson: constraintJson.value,
    measurementDraft: measurementEditorOpen.value ? measurementDraft.value : null,
    interfaceDraft: interfaceEditorOpen.value ? interfaceDraft.value : null,
    historyDraft: tab.value === 'history' ? historyDraft.value : null,
    revisitCycle: tab.value === 'spatiotemporal' ? [revisitCycleValue.value, revisitCycleUnit.value] : null,
  })
}
function markDraftSaved() { draftBaseline.value = draftSnapshot() }
function normalizeCapability(value: unknown) {
  return value && typeof value === 'object' ? clone(value) : {}
}
function syncDraft() {
  if (!detail.value) return
  draft.value = clone(detail.value[tab.value] || {})
  if (tab.value === 'attributes') {
    draft.value.measurementItems = clone(detail.value.measurementItems || [])
    draft.value.capability = normalizeCapability(detail.value.attributes?.capability)
    capabilityAdvancedJson.value = JSON.stringify(draft.value.capability.parameters || {}, null, 2)
  }
  if (tab.value === 'spatiotemporal') {
    draft.value.validTimeStart = toDateTimeLocal(draft.value.validTimeStart)
    draft.value.validTimeEnd = toDateTimeLocal(draft.value.validTimeEnd)
    const match = String(draft.value.revisitCycle || '').trim().match(/^([\d.]+)\s*(.*)$/)
    revisitCycleValue.value = match?.[1] || ''
    revisitCycleUnit.value = match?.[2] || '秒'
    draft.value.workingHoursText = JSON.stringify(draft.value.workingHours || {}, null, 2)
  }
  if (tab.value === 'contact') draft.value.contactDetails = clone(draft.value.contactDetails || {})
  if (tab.value === 'constraints') {
    constraintJson.value = Object.fromEntries(['environmental', 'permission', 'sharing', 'security', 'cost', 'scheduling'].map((key) => [key, JSON.stringify(draft.value[key] || {}, null, 2)]))
  }
  if (tab.value === 'geographic') draft.value.spatialAdvancedText = JSON.stringify({ attitude: draft.value.attitude || {}, fieldOfView: draft.value.fieldOfView || {} }, null, 2)
  markDraftSaved()
}
async function loadSensors() {
  loading.value = true
  error.value = ''
  try {
    const response = await api.listSensors('?pageSize=200')
    sensors.value = rows(response.data)
    const requestedId = props.sensorId || (typeof route.query.sensorId === 'string' ? route.query.sensorId : '')
    const requestedSensor = sensors.value.find((item) => String(item.id) === requestedId)
    const initialSensor = requestedSensor || sensors.value[0]
    if (!selectedId.value && initialSensor) selectedId.value = String(initialSensor.id)
    tab.value = sectionFromQuery(route.query.section)
    await loadDetail()
    if (route.query.focus === 'incomplete' && detail.value) {
      const firstIncomplete = tabs.find(([key]) => !isSectionComplete(key))?.[0]
      if (firstIncomplete && firstIncomplete !== tab.value) {
        tab.value = firstIncomplete
        syncDraft()
        await router.replace({ query: { ...route.query, section: firstIncomplete } })
      }
    }
  } catch (cause) {
    error.value = errMessage(cause, '传感器列表加载失败')
  } finally { loading.value = false }
}
async function loadDetail() {
  if (!selectedId.value) { detail.value = null; return }
  loading.value = true
  try {
    const response = await api.getSensorOctuple(selectedId.value)
    detail.value = response.data as Row
    syncDraft()
  } catch (cause) {
    error.value = errMessage(cause, '传感器完整档案加载失败')
  } finally { loading.value = false }
}
async function selectTab(key: string) {
  if (key === tab.value) return
  if (currentSectionDirty.value && !window.confirm('当前分区有未保存修改，确定切换并放弃这些修改吗？')) return
  tab.value = key
  syncDraft()
  await router.replace({ query: { ...route.query, section: key, mode: requestedMode.value } })
}
async function enterEditMode() {
  if (!currentSectionPermission.value) return
  await router.replace({ query: { ...route.query, section: tab.value, mode: 'edit' } })
}
async function exitEditMode() {
  if (currentSectionDirty.value && !window.confirm('当前分区有未保存修改，确定退出编辑并放弃这些修改吗？')) return
  syncDraft()
  await router.replace({ query: { ...route.query, section: tab.value, mode: 'view' } })
}
function parseObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是对象`)
    return parsed
  } catch (cause) { throw new Error(`${label}格式不正确：${cause instanceof Error ? cause.message : '请输入 JSON 对象'}`) }
}
function beginMeasurement(item?: Row) {
  measurementEditorOpen.value = true
  editingMeasurementId.value = item?.id ? String(item.id) : ''
  measurementDraft.value = {
    id: item?.id ? String(item.id) : '', code: item?.code || '', name: item?.name || '', unit: item?.unit || '',
    parametersText: JSON.stringify(item?.parameters || {}, null, 2),
  }
}
function cancelMeasurement() { measurementEditorOpen.value = false; editingMeasurementId.value = ''; measurementDraft.value = { id: '', code: '', name: '', unit: '', parametersText: '{}' } }
function saveMeasurement() {
  const form = measurementDraft.value
  const code = form.code.trim()
  const name = form.name.trim()
  if (!code || !name) { error.value = '量测项必须填写编码和名称'; return }
  let parameters: Row
  try { parameters = parseObject(form.parametersText, '量测项参数') } catch (cause) { error.value = errMessage(cause, '量测项参数格式不正确'); return }
  const items = rows(draft.value.measurementItems)
  if (items.some((item) => item.code === code && String(item.id || '') !== editingMeasurementId.value)) { error.value = `量测项编码重复：${code}`; return }
  const next = { id: form.id || undefined, code, name, unit: form.unit.trim(), parameters }
  const index = items.findIndex((item) => String(item.id || '') === editingMeasurementId.value)
  if (index >= 0) items.splice(index, 1, next)
  else items.push(next)
  draft.value.measurementItems = items
  cancelMeasurement()
  error.value = ''
}
function removeMeasurement(item: Row) {
  if (!window.confirm(`确定删除量测项“${item.name || item.code}”吗？保存后才会提交删除。`)) return
  draft.value.measurementItems = rows(draft.value.measurementItems).filter((current) => String(current.id || '') !== String(item.id || '') && current.code !== item.code)
}
function beginInterface(item?: Row) {
  interfaceEditorOpen.value = true
  editingInterfaceId.value = item?.id ? String(item.id) : ''
  interfaceDraft.value = {
    id: item?.id ? String(item.id) : '', interfaceType: item?.interfaceType || item?.interface_type || 'observation',
    name: item?.name || '', endpoint: item?.endpoint || '', protocol: item?.protocol || '', dataFormat: item?.dataFormat || item?.data_format || '',
    authMethod: item?.authMethod || item?.auth_method || 'none', credentialReference: item?.credentialReference || '',
    serviceStatus: item?.serviceStatus || item?.service_status || 'unknown', metadataText: JSON.stringify(item?.metadata || {}, null, 2),
  }
}
function cancelInterface() { interfaceEditorOpen.value = false; editingInterfaceId.value = ''; interfaceDraft.value = { id: '', interfaceType: 'observation', name: '', endpoint: '', protocol: '', dataFormat: '', authMethod: 'none', credentialReference: '', serviceStatus: 'unknown', metadataText: '{}' } }
function saveInterface() {
  const form = interfaceDraft.value
  if (!form.name.trim()) { error.value = '接口名称不能为空'; return }
  if (form.credentialReference.trim() && !/^(env|secret|vault):\S+$/.test(form.credentialReference.trim())) {
    error.value = '凭据只允许填写 env:、secret: 或 vault: 开头的外部引用'
    return
  }
  let metadata: Row
  try { metadata = parseObject(form.metadataText, '接口元数据') } catch (cause) { error.value = errMessage(cause, '接口元数据格式不正确'); return }
  const next = { id: form.id || undefined, interfaceType: form.interfaceType, name: form.name.trim(), endpoint: form.endpoint.trim(), protocol: form.protocol.trim(), dataFormat: form.dataFormat.trim(), authMethod: form.authMethod, credentialReference: form.credentialReference.trim(), serviceStatus: form.serviceStatus, metadata }
  const items = rows(draft.value)
  const index = items.findIndex((item) => String(item.id || '') === editingInterfaceId.value)
  if (index >= 0) items.splice(index, 1, next)
  else items.push(next)
  draft.value = items
  cancelInterface()
  error.value = ''
}
function removeInterface(item: Row) {
  if (!window.confirm(`确定删除接入接口“${item.name}”吗？保存后才会提交删除。`)) return
  draft.value = rows(draft.value).filter((current) => String(current.id || '') !== String(item.id || ''))
}
function historyItemValue(item: Row, camel: string, snake: string) { return item[camel] ?? item[snake] }
async function saveCurrent() {
  if (!selectedId.value) return
  saving.value = true
  error.value = ''
  try {
    let payload: Row
    if (tab.value === 'attributes') {
      const capability = normalizeCapability(draft.value.capability) as Row
      capability.parameters = parseObject(capabilityAdvancedJson.value, '能力高级参数')
      payload = { attributes: { ...draft.value, capability, measurementItems: rows(draft.value.measurementItems) } }
      delete payload.attributes.capabilityText
    } else if (tab.value === 'geographic') {
      const advanced = parseObject(draft.value.spatialAdvancedText || '{}', '姿态与视场')
      payload = { geographic: { ...draft.value, attitude: advanced.attitude || {}, fieldOfView: advanced.fieldOfView || {} } }
    }
    else if (tab.value === 'history') {
      if (!historyDraft.value.occurredAt) throw new Error('请选择运行履历发生时间')
      payload = { history: [{ ...historyDraft.value, occurredAt: new Date(historyDraft.value.occurredAt).toISOString() }] }
    } else if (tab.value === 'constraints') {
      payload = { constraints: Object.fromEntries(Object.entries(constraintJson.value).map(([key, text]) => [key, parseObject(text, key)])) }
    } else if (tab.value === 'interfaces') payload = { interfaces: rows(draft.value) }
    else if (tab.value === 'spatiotemporal') {
      const start = draft.value.validTimeStart ? new Date(draft.value.validTimeStart) : null
      const end = draft.value.validTimeEnd ? new Date(draft.value.validTimeEnd) : null
      if (start && end && (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end)) throw new Error('有效结束时间必须晚于有效开始时间')
      payload = { spatiotemporal: { ...draft.value, workingHours: parseObject(draft.value.workingHoursText || '{}', '工作时间'), revisitCycle: revisitCycleValue.value.trim() ? `${revisitCycleValue.value.trim()} ${revisitCycleUnit.value}` : '' } }
    } else payload = { [tab.value]: draft.value }
    await api.updateSensorOctuple(selectedId.value, payload)
    message.value = `${tabs.find((item) => item[0] === tab.value)?.[1]}已保存`
    await loadDetail()
  } catch (cause) {
    error.value = errMessage(cause, '档案保存失败')
  } finally { saving.value = false }
}
function confirmUnsaved() {
  return !currentSectionDirty.value || window.confirm('当前档案有未保存修改，确定离开并放弃这些修改吗？')
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!currentSectionDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void loadSensors()
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => confirmUnsaved())
onBeforeRouteUpdate((to, from) => {
  const contextChanged = to.query.sensorId !== from.query.sensorId || to.query.section !== from.query.section
  return !contextChanged || confirmUnsaved()
})
watch(() => props.sensorId, async (id) => {
  if (!id || id === selectedId.value) return
  selectedId.value = id
  await loadDetail()
})
watch(historyItems, () => {
  historyPage.value = Math.min(historyPage.value, historyPageCount.value)
})
watch(() => String(route.query.section || ''), (value) => {
  const next = sectionFromQuery(value)
  if (next !== tab.value && !currentSectionDirty.value) { tab.value = next; syncDraft() }
})
</script>

<template>
  <section class="page metadata-page" :class="{ embedded: props.embedded }">
    <header v-if="!props.embedded" class="page-head resource-head">
      <div><p class="eyebrow">传感器完整档案</p><h1>传感器信息维护</h1></div>
      <RouterLink :to="{ path: String(route.query.returnTo || '/resources/sensors'), query: route.query.returnTo ? { runId: route.query.runId, tab: route.query.currentTab, scrollY: route.query.scrollY } : { tab: route.query.currentTab || route.query.tab || 'crud' } }" class="back-link">返回来源页面</RouterLink>
    </header>
    <ContextGuide v-if="!props.embedded" storage-key="newcity-sensor-profile-guide" kicker="传感器完整档案怎么用" title="按分区维护真实档案" summary="基础信息、观测能力、空间位置和接入条件共同描述一个可复用的传感器资源。" :steps="metadataGuideSteps" reopen-label="查看档案说明" />
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="ok-text" role="status">{{ message }}</p>
    <template v-if="!props.embedded">
      <input v-model="keyword" type="search" placeholder="搜索传感器或平台" />
      <select v-model="selectedId" class="sensor-select" @change="loadDetail"><option value="">选择传感器</option><option v-for="item in filteredSensors" :key="item.id" :value="String(item.id)">{{ item.sensorName || item.name || `传感器 #${item.id}` }} · {{ item.platformName || '' }}</option></select>
    </template>
    <p v-if="loading" class="hint">正在读取传感器完整档案…</p>
    <div v-else-if="!detail" class="empty-state">暂无传感器。请先在传感器资源管理中登记资源。</div>
    <template v-else>
      <article class="sensor-context">
        <div><span>{{ detail.type || '传感器' }}</span><em :class="String(detail.platformStatus || detail.general?.status || '')">{{ detail.platformStatus || detail.general?.status || '状态未登记' }}</em></div>
        <strong>{{ detail.name || detail.general?.sensorName }}</strong>
        <p>{{ detail.platformName || detail.general?.name || '未关联平台' }} · {{ detail.general?.identifier || `传感器 #${detail.id}` }}</p>
        <div class="profile-progress"><i :style="{ width: `${profileRatio * 100}%` }"></i></div>
        <small>档案完整度 {{ completedSectionCount }} / {{ profileCompleteness?.totalCount || tabs.length }} 个分区；不等同于可用状态或任务匹配结果。</small>
      </article>
      <div class="octuple-heading"><strong>传感器完整档案</strong><small>当前分区：{{ sectionStatus === 'complete' ? '已维护' : '待补充' }}</small></div>
      <div class="octuple-tabs" role="tablist" aria-label="传感器完整档案分区">
        <button v-for="item in tabs" :key="item[0]" type="button" :class="{ active: tab === item[0] }" @click="selectTab(item[0])"><i :class="{ complete: isSectionComplete(item[0]) }" aria-hidden="true"></i><span><strong>{{ item[1] }}</strong><small>{{ tabBriefs[item[0]] }}</small></span></button>
      </div>
      <section class="panel editor archive-fieldset">
        <div class="editor-head"><div><p class="eyebrow">当前分区</p><h3>{{ tabs.find((item) => item[0] === tab)?.[1] }}</h3></div><div class="editor-mode-actions"><small>{{ currentTabBrief }}<template v-if="currentSectionDirty"> · 有未保存修改</template></small><button v-if="archiveMode && currentSectionPermission" class="btn ghost tiny" type="button" @click="enterEditMode">进入编辑</button><button v-else-if="!archiveMode" class="btn ghost tiny" type="button" @click="exitEditMode">退出编辑</button><small v-else>当前用户无该分区编辑权限</small></div></div>
        <fieldset class="archive-fields" :disabled="archiveMode">
        <template v-if="tab === 'general'">
          <div class="subsection"><strong>传感器信息</strong><div class="form-grid"><label>传感器名称<input v-model.trim="draft.sensorName" /></label><label>传感器类型<input :value="detail.type || '未登记'" disabled /></label></div></div>
          <div class="subsection"><strong>所属平台信息</strong><p class="field-note">修改平台信息将影响该平台下的全部传感器。</p><div class="form-grid"><label>平台名称<input v-model.trim="draft.name" /></label><label>平台标识<input v-model.trim="draft.identifier" /></label><label>型号<input v-model.trim="draft.model" /></label><label>厂商<input v-model.trim="draft.manufacturer" /></label><label>所属单位<input v-model.trim="draft.owner" /></label><label>状态<select v-model="draft.status"><option value="active">启用</option><option value="offline">离线</option><option value="maintenance">维护</option><option value="inactive">停用</option></select></label><label class="wide">说明<textarea v-model.trim="draft.description" rows="3"></textarea></label></div></div>
        </template>
        <template v-else-if="tab === 'attributes'">
          <div class="form-grid"><label class="wide">感知原理与能力说明<textarea v-model="draft.capability.principle" rows="3" placeholder="例如：通过翻斗计量降雨量"></textarea></label><label>空间分辨率（m）<input v-model.number="draft.spatialResolutionM" type="number" min="0" step="any" /></label><label>时间分辨率（秒）<input v-model.number="draft.temporalResolutionSeconds" type="number" min="0" step="any" /></label><label>准确度（%）<input v-model.number="draft.accuracyPercent" type="number" min="0" max="100" step="any" /></label><label>可靠度（%）<input v-model.number="draft.reliabilityPercent" type="number" min="0" max="100" step="any" /></label><label>分类<select v-model="draft.classification"><option value="">未分类</option><option value="environment">环境监测</option><option value="hydrology">水文监测</option><option value="meteorology">气象监测</option><option value="geology">地学监测</option></select></label><label>关键词<input v-model="draft.keywords" placeholder="用逗号分隔" /></label><label class="wide">能力高级参数（JSON）<textarea v-model="capabilityAdvancedJson" class="mono" rows="4"></textarea></label></div>
          <div class="subsection"><div class="subsection-head"><strong>量测项</strong><button class="btn ghost tiny" type="button" @click="beginMeasurement()">新增量测项</button></div><table v-table-pager="{ label: '量测项分页' }" class="table measurement-table"><thead><tr><th>编码</th><th>名称</th><th>单位</th><th>参数</th><th>操作</th></tr></thead><tbody><tr v-if="!draft.measurementItems?.length"><td colspan="5" class="muted">暂无量测项，请至少维护一个可观测要素。</td></tr><tr v-for="item in draft.measurementItems || []" :key="item.id || item.code"><td><code>{{ item.code }}</code></td><td>{{ item.name }}</td><td>{{ item.unit || '-' }}</td><td class="clamp">{{ JSON.stringify(item.parameters || {}) }}</td><td class="ops"><button class="btn ghost tiny" type="button" @click="beginMeasurement(item)">编辑</button><button class="btn ghost tiny danger" type="button" @click="removeMeasurement(item)">删除</button></td></tr></tbody></table><div v-if="measurementEditorOpen" class="inline-editor"><label>编码<input v-model.trim="measurementDraft.code" /></label><label>名称<input v-model.trim="measurementDraft.name" /></label><label>单位<input v-model.trim="measurementDraft.unit" /></label><label class="wide">参数 JSON<textarea v-model="measurementDraft.parametersText" class="mono" rows="3"></textarea></label><div><button class="btn ghost tiny" type="button" @click="cancelMeasurement">取消</button><button class="btn tiny" type="button" @click="saveMeasurement">保存量测项</button></div></div></div>
        </template>
        <template v-else-if="tab === 'spatiotemporal'">
          <div class="form-grid"><label>坐标系<input v-model.trim="draft.coordinateSystem" placeholder="例如 EPSG:4326" /></label><label>时间基准<input v-model.trim="draft.timeReference" placeholder="例如 UTC+08:00" /></label><label>有效开始<input v-model="draft.validTimeStart" type="datetime-local" /></label><label>有效结束<input v-model="draft.validTimeEnd" type="datetime-local" /></label><label>重访周期数值<input v-model.trim="revisitCycleValue" type="number" min="0" step="any" /></label><label>重访周期单位<select v-model="revisitCycleUnit"><option>秒</option><option>分钟</option><option>小时</option><option>天</option></select></label><label class="wide">工作时间（JSON）<textarea v-model="draft.workingHoursText" class="mono" rows="3" placeholder="例如 {&quot;timezone&quot;:&quot;Asia/Shanghai&quot;,&quot;windows&quot;:[{&quot;start&quot;:&quot;08:00&quot;,&quot;end&quot;:&quot;18:00&quot;}]}" /></label></div>
        </template>
        <template v-else-if="tab === 'geographic'"><div class="form-grid"><label class="wide">传感器位置 WKT<textarea v-model.trim="draft.locationWkt" rows="2" placeholder="POINT (经度 纬度)"></textarea></label><label>高度（m）<input v-model.number="draft.heightM" type="number" step="any" /></label><label class="wide">覆盖范围 WKT<textarea v-model.trim="draft.coverageWkt" rows="3" placeholder="POLYGON ((...))"></textarea></label><label class="wide">轨迹 WKT<textarea v-model.trim="draft.trajectoryWkt" rows="2"></textarea></label><label class="wide">姿态与视场（JSON）<textarea v-model="draft.spatialAdvancedText" class="mono" rows="3">{{ JSON.stringify({ attitude: draft.attitude || {}, fieldOfView: draft.fieldOfView || {} }, null, 2) }}</textarea></label></div><p class="field-note">位置表示传感器所在点，覆盖范围表示可观测区域；保存前请确认 WKT 几何有效。</p></template>
        <template v-else-if="tab === 'history'"><div class="metadata-list"><div v-for="item in pagedHistoryItems" :key="item.id"><strong>{{ historyItemValue(item, 'eventType', 'event_type') }}</strong> · {{ historyItemValue(item, 'occurredAt', 'occurred_at') }} · {{ historyItemValue(item, 'description', 'description') || '无说明' }}<em v-if="item.capabilityChange?.voided || item.capability_change?.voided">（已作废）</em></div><div v-if="!historyItems.length" class="empty-inline">暂无运行履历</div></div><CardPager v-model:page="historyPage" kind="records" :pages="historyPageLabels" :summary="`共 ${historyItems.length} 条`" label="运行履历分页" /><div class="form-grid"><label>事件类型<select v-model="historyDraft.eventType"><option value="deployment">部署</option><option value="calibration">校准</option><option value="maintenance">维护</option><option value="fault">故障</option><option value="capability_change">能力变化</option></select></label><label>发生时间<input v-model="historyDraft.occurredAt" type="datetime-local" /></label><label class="wide">说明<textarea v-model.trim="historyDraft.description" rows="2"></textarea></label></div><p class="field-note">正式履历不提供物理删除；如需更正，请新增一条更正履历并说明原因。</p></template>
        <template v-else-if="tab === 'contact'"><div class="form-grid"><label>责任单位<input v-model.trim="draft.responsibleOrganization" /></label><label>责任部门<input v-model.trim="draft.responsibleDepartment" /></label><label>负责人<input v-model.trim="draft.responsiblePerson" /></label><label>运维联系人<input v-model.trim="draft.maintenanceContact" /></label><label>联系电话<input v-model.trim="draft.contactDetails.phone" /></label><label>联系邮箱<input v-model.trim="draft.contactDetails.email" type="email" /></label><label class="wide">联系备注<textarea v-model.trim="draft.contactDetails.notes" rows="3"></textarea></label></div></template>
        <template v-else-if="tab === 'constraints'"><div class="form-grid constraint-grid"><label v-for="key in ['environmental', 'permission', 'sharing', 'security', 'cost', 'scheduling']" :key="key">{{ ({ environmental: '环境约束', permission: '权限约束', sharing: '共享约束', security: '安全约束', cost: '成本约束', scheduling: '调度约束' } as Row)[key] }}<textarea v-model="constraintJson[key]" class="mono" rows="5"></textarea></label></div><p class="field-note">高级约束以 JSON 保存；请不要填写 API 密钥、密码或令牌原文。</p></template>
        <template v-else><div class="subsection"><div class="subsection-head"><strong>接入接口</strong><button class="btn ghost tiny" type="button" @click="beginInterface()">新增接口</button></div><table v-table-pager="{ label: '接入接口分页' }" class="table interface-table"><thead><tr><th>类型 / 名称</th><th>协议 / 格式</th><th>认证</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-if="!draft.length"><td colspan="5" class="muted">暂无接入接口</td></tr><tr v-for="item in draft" :key="item.id || item.name"><td>{{ item.interfaceType || item.interface_type }} · {{ item.name }}</td><td>{{ item.protocol || '-' }} / {{ item.dataFormat || item.data_format || '-' }}</td><td>{{ item.authMethod || item.auth_method || 'none' }}<small v-if="item.credentialConfigured || item.credentialReference"> · 凭据引用已配置</small></td><td>{{ item.serviceStatus || item.service_status || 'unknown' }}</td><td class="ops"><button class="btn ghost tiny" type="button" @click="beginInterface(item)">编辑</button><button class="btn ghost tiny danger" type="button" @click="removeInterface(item)">删除</button></td></tr></tbody></table><div v-if="interfaceEditorOpen" class="inline-editor"><div class="form-grid"><label>接口类型<input v-model.trim="interfaceDraft.interfaceType" /></label><label>接口名称<input v-model.trim="interfaceDraft.name" /></label><label>协议<input v-model.trim="interfaceDraft.protocol" /></label><label>数据格式<input v-model.trim="interfaceDraft.dataFormat" /></label><label>认证方式<select v-model="interfaceDraft.authMethod"><option value="none">无</option><option value="token">令牌引用</option><option value="credential-reference">凭据引用</option></select></label><label>服务状态<select v-model="interfaceDraft.serviceStatus"><option value="unknown">未知</option><option value="online">在线</option><option value="offline">离线</option><option value="maintenance">维护</option></select></label><label class="wide">服务地址<input v-model.trim="interfaceDraft.endpoint" /></label><label class="wide">新凭据引用（留空则保持原值）<input v-model.trim="interfaceDraft.credentialReference" placeholder="env:DEVICE_TOKEN / secret:... / vault:..." /></label><label class="wide">接口元数据 JSON<textarea v-model="interfaceDraft.metadataText" class="mono" rows="3"></textarea></label></div><button class="btn ghost tiny" type="button" @click="cancelInterface">取消</button><button class="btn tiny" type="button" @click="saveInterface">保存接口</button></div></div></template>
        <button v-if="!archiveMode" class="btn primary" :disabled="saving" @click="saveCurrent">{{ saving ? '保存中…' : `保存${tabs.find((item) => item[0] === tab)?.[1]}` }}</button>
        </fieldset>
      </section>
    </template>
  </section>
</template>

<style scoped>
.metadata-page { --profile-card-border: #e5e5ea; --profile-card-radius: 16px; padding-bottom: 1rem; }
.metadata-page.embedded { padding: 0; }
.resource-head { align-items: flex-start; }
.back-link { color: #0071e3; font-size: 11px; text-decoration: none; border-bottom: 1px solid #9bc7f3; }
.sensor-select { width: 100%; margin: .35rem 0 .55rem; }
.sensor-context { display: grid; gap: .3rem; padding: .65rem; border: 1px solid var(--profile-card-border); border-radius: var(--profile-card-radius); background: #fff; }
.sensor-context > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: .35rem; }
.sensor-context span, .sensor-context em, .sensor-context p, .sensor-context small { font-size: 11px; }
.sensor-context span, .sensor-context p, .sensor-context small { color: #6e6e73; }
.sensor-context em { padding: .12rem .38rem; border: 1px solid #dcdde1; border-radius: 6px; background: #f5f5f7; color: #5d6664; font-style: normal; }
.sensor-context em.active { border-color: #b7d7f7; background: #f0f7ff; color: #005bb5; }
.sensor-context > strong { color: #1d1d1f; font-size: 15px; overflow-wrap: anywhere; }
.sensor-context p, .sensor-context small { margin: 0; line-height: 1.45; }
.profile-progress { height: 5px; overflow: hidden; border-radius: 3px; background: #e5e7e7; }
.profile-progress i { display: block; height: 100%; border-radius: inherit; background: #0071e3; transition: width .2s ease; }
.octuple-heading { display: flex; align-items: baseline; justify-content: space-between; gap: .4rem; margin: .65rem 0 .3rem; }
.octuple-heading strong { color: #1d1d1f; font-size: 13px; }
.octuple-heading small { color: #6e6e73; font-size: 11px; }
.octuple-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }
.octuple-tabs button { display: grid; grid-template-columns: .55rem 1fr; align-items: start; gap: .35rem; min-width: 0; padding: .52rem; border: 1px solid var(--profile-card-border); border-radius: var(--profile-card-radius); background: #fff; color: #515154; text-align: left; cursor: pointer; }
.octuple-tabs button > i { width: 7px; height: 7px; margin-top: .22rem; border: 1px solid #9eafac; border-radius: 50%; background: #fff; }
.octuple-tabs button > i.complete { border-color: #34c759; background: #34c759; }
.octuple-tabs button > span { display: grid; gap: .08rem; min-width: 0; }
.octuple-tabs button strong { color: inherit; font-size: 11px; }
.octuple-tabs button small { color: #6e6e73; font-size: 11px; line-height: 1.3; }
.octuple-tabs button.active { color: #005bb5; border-color: #b7d7f7; background: #f0f7ff; }
.editor { display: grid; gap: .6rem; margin-top: .65rem; padding: .65rem; border-color: var(--profile-card-border); border-radius: var(--profile-card-radius); background: #fff; box-shadow: none; }
.editor-head { display: flex; align-items: flex-end; justify-content: space-between; gap: .45rem; padding-bottom: .45rem; border-bottom: 1px solid #e5e5e8; }
.editor-head p, .editor-head h3 { margin: 0; }
.editor-head h3 { color: #1d1d1f; font-size: 14px; }
.editor-head > small { max-width: 55%; color: #6e6e73; font-size: 11px; text-align: right; }
.editor-mode-actions { display: flex; align-items: center; justify-content: flex-end; gap: .35rem; flex-wrap: wrap; }
.editor-mode-actions small { color: #6e6e73; font-size: 11px; text-align: right; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; }
.editor label { display: grid; gap: .2rem; color: #515154; font-size: 11px; }
.editor label.wide { grid-column: 1 / -1; }
.editor input, .editor select, .editor textarea { min-width: 0; width: 100%; box-sizing: border-box; }
.archive-fields { display: grid; gap: .6rem; min-width: 0; margin: 0; padding: 0; border: 0; }
.subsection { display: grid; gap: .45rem; }
.subsection-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
.subsection-head strong { font-size: 12px; }
.metadata-list { display: grid; gap: .35rem; padding: .55rem; border: 1px solid #e5e5ea; border-radius: 12px; background: #f7f7f9; color: #515154; font-size: 11px; }
.metadata-list em { color: #b3261e; font-style: normal; }
.measurement-table, .interface-table { font-size: 11px; }
.measurement-table th, .measurement-table td, .interface-table th, .interface-table td { white-space: normal; overflow-wrap: anywhere; }
.measurement-table .ops, .interface-table .ops { display: flex; gap: .25rem; flex-wrap: wrap; }
.inline-editor { display: grid; gap: .5rem; padding: .6rem; border: 1px solid #b7d7f7; border-radius: 12px; background: #f0f7ff; }
.inline-editor > div:last-child { display: flex; gap: .35rem; justify-content: flex-end; }
.constraint-grid label { min-height: 9rem; }
.field-note, .muted, .empty-inline { color: #6e6e73; font-size: 11px; line-height: 1.5; }
.field-note { margin: 0; }
.mono { font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.tiny { min-height: 28px; padding: .25rem .45rem; font-size: 11px; }
.danger { color: #b3261e; }
.ok-text { color: #248a3d; font-size: 12px; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .editor label.wide { grid-column: auto; } .octuple-tabs { grid-template-columns: 1fr; } }
</style>
