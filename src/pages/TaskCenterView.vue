<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import { errMessage, isoNow } from '../utils/errors'

type Row = Record<string, any>
const route = useRoute()
const router = useRouter()
const tab = ref('systems')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 4
const sectionPage = ref(1)
const nodePage = ref(1)
const taskSystemPage = ref(1)
const taskPage = ref(1)
const systems = ref<Row[]>([])
const nodes = ref<Row[]>([])
const elements = ref<Row[]>([])
const scenes = ref<Row[]>([])
const tasks = ref<Row[]>([])
const taskSystems = ref<Row[]>([])
const selectedSystemId = ref('')
const selectedNodeIds = ref<string[]>([])
const editingSystemId = ref('')
const editingNodeId = ref('')
const editingTaskSystemId = ref('')
const systemForm = ref({ code: '', name: '', sceneId: '', description: '' })
const nodeForm = ref({ level: 'indicator', code: '', name: '', parentId: '', sensingElementId: '', temporalResolution: 'PT30M', spatialResolution: '1km', observationAccuracy: '90%', monitoringFrequency: '每30分钟', coverageRequirement: '任务区域全覆盖', unit: '', description: '' })
const taskForm = ref({ name: '', sceneId: '', observationTaskId: '' })
const editingObservationTaskId = ref('')
const observationTaskForm = ref({
  name: '',
  observationTarget: '',
  description: '',
  sceneId: '',
  priority: 'normal',
  taskType: 'manual',
  timeStart: isoNow(-30 * 60_000).slice(0, 16),
  timeEnd: isoNow(2 * 60 * 60_000).slice(0, 16),
})
const lastVersion = ref<Row | null>(null)

const tabs = [
  { key: 'task-create', label: '任务创建' },
  { key: 'task-manage', label: '任务管理' },
  { key: 'systems', label: '指标体系' },
  { key: 'modeling', label: '手工建模' },
  { key: 'versions', label: '版本追溯' },
]
const filteredSystems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return systems.value.filter((item) => !q || `${item.code} ${item.name} ${item.description || ''}`.toLowerCase().includes(q))
})
const pagedSystems = computed(() => filteredSystems.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredSystems.value.length / pageSize)))
const selectedSystem = computed(() => systems.value.find((item) => String(item.id) === selectedSystemId.value))
const indicatorNodes = computed(() => nodes.value.filter((item) => item.level === 'indicator'))
const nodePageCount = computed(() => Math.max(1, Math.ceil(nodes.value.length / pageSize)))
const pagedNodes = computed(() => nodes.value.slice((nodePage.value - 1) * pageSize, nodePage.value * pageSize))
const taskSystemPageCount = computed(() => Math.max(1, Math.ceil(taskSystems.value.length / pageSize)))
const pagedTaskSystems = computed(() => taskSystems.value.slice((taskSystemPage.value - 1) * pageSize, taskSystemPage.value * pageSize))
const taskPageCount = computed(() => Math.max(1, Math.ceil(tasks.value.length / pageSize)))
const pagedTasks = computed(() => tasks.value.slice((taskPage.value - 1) * pageSize, taskPage.value * pageSize))
const sectionPages = computed(() => ({
  'task-create': [editingObservationTaskId.value ? '编辑任务' : '填写任务', '保存后进入任务管理'],
  'task-manage': ['任务列表'],
  systems: [editingSystemId.value ? '编辑指标体系' : '新建指标体系', '已有指标体系'],
  modeling: [editingNodeId.value ? '编辑体系节点' : '添加体系节点', '体系节点列表'],
  'task-systems': [editingTaskSystemId.value ? '编辑任务指标' : '建立任务指标', '任务指标草案'],
  versions: ['保存版本', '版本快照'],
}[tab.value] || ['业务内容']))
const systemPageLabels = computed(() => Array.from({ length: pageCount.value }, (_, index) => `指标体系第 ${index + 1} 页`))
const nodePageLabels = computed(() => Array.from({ length: nodePageCount.value }, (_, index) => `体系节点第 ${index + 1} 页`))
const taskSystemPageLabels = computed(() => Array.from({ length: taskSystemPageCount.value }, (_, index) => `任务指标第 ${index + 1} 页`))
const taskPageLabels = computed(() => Array.from({ length: taskPageCount.value }, (_, index) => `任务第 ${index + 1} 页`))

function syncTab() {
  const value = String(route.query.tab || 'systems')
  const legacyTabs = new Set(['task-systems'])
  tab.value = tabs.some((item) => item.key === value) || legacyTabs.has(value) ? value : 'systems'
}
async function setTab(key: string) {
  await router.replace({ path: route.path, query: { tab: key } })
}
function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : []
}
async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [systemRes, elementRes, sceneRes, taskRes, observationTaskRes] = await Promise.all([
      api.listIndicatorSystems(), api.listSensingElements(), api.listScenes(), api.listTaskIndicatorSystems(), api.listTasks(),
    ])
    systems.value = asRows(systemRes.data)
    elements.value = asRows(elementRes.data)
    scenes.value = asRows(sceneRes.data)
    taskSystems.value = asRows(taskRes.data)
    tasks.value = asRows(observationTaskRes.data)
    const requestedTaskId = String(route.query.taskId || '')
    const requestedTask = tasks.value.find((item) => String(item.id) === requestedTaskId)
    if (requestedTask) {
      taskForm.value.observationTaskId = requestedTaskId
      taskForm.value.sceneId = String(requestedTask.sceneId || route.query.sceneId || '')
    }
    const firstSystem = systems.value[0]
    if (!selectedSystemId.value && firstSystem) selectedSystemId.value = String(firstSystem.id)
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '任务中心数据加载失败')
  } finally {
    loading.value = false
  }
}
async function loadNodes() {
  if (!selectedSystemId.value) {
    nodes.value = []
    return
  }
  try {
    const response = await api.listIndicatorNodes(`?systemId=${encodeURIComponent(selectedSystemId.value)}`)
    nodes.value = asRows(response.data)
  } catch (cause) {
    error.value = errMessage(cause, '指标节点加载失败')
  }
}

function taskStatusLabel(status: unknown) {
  const value = String(status || '').toLowerCase()
  const labels: Record<string, string> = {
    draft: '草稿',
    created: '已创建',
    submitted: '已提交',
    approved: '已审核',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档',
    cancelled: '已取消',
    canceled: '已取消',
  }
  return labels[value] || String(status || '未设置')
}

function resetObservationTaskForm() {
  editingObservationTaskId.value = ''
  observationTaskForm.value = {
    name: '',
    observationTarget: '',
    description: '',
    sceneId: '',
    priority: 'normal',
    taskType: 'manual',
    timeStart: isoNow(-30 * 60_000).slice(0, 16),
    timeEnd: isoNow(2 * 60 * 60_000).slice(0, 16),
  }
}

function editObservationTask(item: Row) {
  editingObservationTaskId.value = String(item.id)
  observationTaskForm.value = {
    name: String(item.name || ''),
    observationTarget: String(item.observationTarget || ''),
    description: String(item.description || ''),
    sceneId: item.sceneId == null ? '' : String(item.sceneId),
    priority: String(item.priority || 'normal'),
    taskType: String(item.taskType || 'manual'),
    timeStart: item.timeStart ? String(item.timeStart).slice(0, 16) : isoNow(-30 * 60_000).slice(0, 16),
    timeEnd: item.timeEnd ? String(item.timeEnd).slice(0, 16) : isoNow(2 * 60 * 60_000).slice(0, 16),
  }
  sectionPage.value = 1
  message.value = `正在编辑“${item.name}”`
}

function observationTaskPayload() {
  return {
    name: observationTaskForm.value.name.trim(),
    observationTarget: observationTaskForm.value.observationTarget.trim(),
    description: observationTaskForm.value.description.trim(),
    sceneId: observationTaskForm.value.sceneId ? Number(observationTaskForm.value.sceneId) : null,
    priority: observationTaskForm.value.priority,
    taskType: observationTaskForm.value.taskType,
    timeStart: new Date(observationTaskForm.value.timeStart).toISOString(),
    timeEnd: new Date(observationTaskForm.value.timeEnd).toISOString(),
  }
}

async function saveObservationTask() {
  if (!observationTaskForm.value.name.trim() || !observationTaskForm.value.observationTarget.trim()) {
    error.value = '请填写任务名称和观测目标'
    return
  }
  const start = new Date(observationTaskForm.value.timeStart)
  const end = new Date(observationTaskForm.value.timeEnd)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    error.value = '结束时间必须晚于开始时间'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = observationTaskPayload()
    if (editingObservationTaskId.value) {
      await api.updateTask(editingObservationTaskId.value, payload)
      message.value = '任务修改已保存'
    } else {
      await api.createTask(payload)
      message.value = '任务已创建，可在任务管理中提交或继续配置指标'
    }
    resetObservationTaskForm()
    await loadAll()
    tab.value = 'task-manage'
    sectionPage.value = 1
  } catch (cause) {
    error.value = errMessage(cause, '任务保存失败')
  } finally {
    saving.value = false
  }
}

async function submitObservationTask(item: Row) {
  try {
    await api.submitTask(item.id)
    message.value = `任务“${item.name}”已提交`
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '任务提交失败')
  }
}

async function cancelObservationTask(item: Row) {
  if (!window.confirm(`取消任务“${item.name}”？`)) return
  try {
    await api.cancelTask(item.id)
    message.value = `任务“${item.name}”已取消`
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '任务取消失败')
  }
}

type TaskLifecycleAction = 'approve' | 'start' | 'pause' | 'complete' | 'archive'

async function transitionObservationTask(item: Row, action: TaskLifecycleAction, label: string) {
  const handlers: Record<TaskLifecycleAction, (id: number | string) => Promise<unknown>> = {
    approve: api.approveTask,
    start: api.startTask,
    pause: api.pauseTask,
    complete: api.completeTask,
    archive: api.archiveTask,
  }
  try {
    await handlers[action](item.id)
    message.value = `任务“${item.name}”已${label}`
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, `任务${label}失败`)
  }
}

async function removeObservationTask(item: Row) {
  if (!window.confirm(`删除任务“${item.name}”？仅草稿任务可删除。`)) return
  try {
    await api.deleteTask(item.id)
    message.value = '任务已删除'
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '任务删除失败')
  }
}
async function createSystem() {
  if (!systemForm.value.code.trim() || !systemForm.value.name.trim()) {
    error.value = '请填写指标体系编码和名称'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const body: Row = {
      ...systemForm.value,
      sceneId: systemForm.value.sceneId ? Number(systemForm.value.sceneId) : null,
    }
    const response = editingSystemId.value
      ? await api.updateIndicatorSystem(editingSystemId.value, body)
      : await api.createIndicatorSystem({ ...body, systemType: 'basic', sourceType: 'manual', status: 'draft' })
    message.value = editingSystemId.value ? '指标体系修改已保存' : '指标体系已创建'
    editingSystemId.value = ''
    systemForm.value = { code: '', name: '', sceneId: '', description: '' }
    await loadAll()
    selectedSystemId.value = String((response.data as Row).id)
  } catch (cause) {
    error.value = errMessage(cause, '指标体系保存失败')
  } finally {
    saving.value = false
  }
}
function editSystem(item: Row) {
  editingSystemId.value = String(item.id)
  selectedSystemId.value = String(item.id)
  systemForm.value = {
    code: String(item.code || ''),
    name: String(item.name || ''),
    sceneId: item.sceneId == null ? '' : String(item.sceneId),
    description: String(item.description || ''),
  }
  sectionPage.value = 1
  message.value = `正在编辑“${item.name}”`
}
function cancelSystemEdit() {
  editingSystemId.value = ''
  systemForm.value = { code: '', name: '', sceneId: '', description: '' }
}
async function createNode() {
  if (!selectedSystemId.value || !nodeForm.value.code.trim() || !nodeForm.value.name.trim()) {
    error.value = '请选择指标体系，并填写节点编码和名称'
    return
  }
  if (nodeForm.value.level === 'indicator' && !nodeForm.value.sensingElementId) {
    error.value = '具体观测指标必须选择统一编码的感知要素'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const body: Row = {
      ...nodeForm.value,
      systemId: Number(selectedSystemId.value),
      parentId: nodeForm.value.parentId ? Number(nodeForm.value.parentId) : null,
      sensingElementId: nodeForm.value.sensingElementId ? Number(nodeForm.value.sensingElementId) : null,
      applicableSceneIds: selectedSystem.value?.sceneId ? [selectedSystem.value.sceneId] : [],
    }
    if (editingNodeId.value) await api.updateIndicatorNode(editingNodeId.value, body)
    else await api.createIndicatorNode({ ...body, sourceType: 'manual' })
    message.value = editingNodeId.value ? '指标节点修改已保存' : '指标节点已创建'
    editingNodeId.value = ''
    nodeForm.value.code = ''
    nodeForm.value.name = ''
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '指标节点保存失败')
  } finally {
    saving.value = false
  }
}
function editNode(item: Row) {
  editingNodeId.value = String(item.id)
  nodeForm.value = {
    level: String(item.level || 'indicator'),
    code: String(item.code || ''),
    name: String(item.name || ''),
    parentId: item.parentId == null ? '' : String(item.parentId),
    sensingElementId: item.sensingElementId == null ? '' : String(item.sensingElementId),
    temporalResolution: String(item.temporalResolution || ''),
    spatialResolution: String(item.spatialResolution || ''),
    observationAccuracy: String(item.observationAccuracy || ''),
    monitoringFrequency: String(item.monitoringFrequency || ''),
    coverageRequirement: String(item.coverageRequirement || ''),
    unit: String(item.unit || ''),
    description: String(item.description || ''),
  }
  sectionPage.value = 1
  message.value = `正在编辑节点“${item.name}”`
}
function cancelNodeEdit() {
  editingNodeId.value = ''
  nodeForm.value.code = ''
  nodeForm.value.name = ''
}
async function removeNode(item: Row) {
  if (!window.confirm(`删除指标节点“${item.name}”？已被任务引用时系统会阻止删除。`)) return
  try {
    await api.deleteIndicatorNode(item.id)
    message.value = '指标节点已删除'
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '节点删除失败')
  }
}
async function createTaskSystem() {
  const isEditing = Boolean(editingTaskSystemId.value)
  if (!taskForm.value.name.trim() || (!isEditing && !taskForm.value.sceneId) || selectedNodeIds.value.length === 0) {
    error.value = isEditing
      ? '请填写名称并至少选择一个具体观测指标'
      : '请填写名称、选择场景并至少选择一个具体观测指标'
    return
  }
  saving.value = true
  try {
    const body: Row = isEditing
      ? { name: taskForm.value.name, selectedNodeIds: selectedNodeIds.value.map(Number) }
      : {
          name: taskForm.value.name,
          sceneId: Number(taskForm.value.sceneId),
          baseSystemId: selectedSystemId.value ? Number(selectedSystemId.value) : null,
          observationTaskId: taskForm.value.observationTaskId ? Number(taskForm.value.observationTaskId) : null,
          selectedNodeIds: selectedNodeIds.value.map(Number),
        }
    if (editingTaskSystemId.value) await api.updateTaskIndicatorSystem(editingTaskSystemId.value, body)
    else await api.createTaskIndicatorSystem({ ...body, requirements: { source: 'manual' }, sourceType: 'manual' })
    message.value = editingTaskSystemId.value ? '任务指标体系修改已保存' : '任务指标体系草案已创建'
    editingTaskSystemId.value = ''
    taskForm.value.name = ''
    taskForm.value.observationTaskId = ''
    selectedNodeIds.value = []
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '任务指标体系创建失败')
  } finally {
    saving.value = false
  }
}
function editTaskSystem(item: Row) {
  editingTaskSystemId.value = String(item.id)
  taskForm.value = {
    name: String(item.name || ''),
    sceneId: item.sceneId == null ? '' : String(item.sceneId),
    observationTaskId: item.observationTaskId == null ? '' : String(item.observationTaskId),
  }
  selectedSystemId.value = item.baseSystemId == null ? '' : String(item.baseSystemId)
  selectedNodeIds.value = Array.isArray(item.selectedNodeIds) ? item.selectedNodeIds.map(String) : []
  sectionPage.value = 1
  message.value = `正在编辑“${item.name}”`
}
function cancelTaskSystemEdit() {
  editingTaskSystemId.value = ''
  taskForm.value = { name: '', sceneId: '', observationTaskId: '' }
  selectedNodeIds.value = []
}
async function confirmTaskSystem(item: Row) {
  if (!window.confirm(`确认“${item.name}”作为正式任务指标体系？`)) return
  try {
    await api.confirmTaskIndicatorSystem(item.id)
    message.value = '任务指标体系已人工确认'
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '确认失败')
  }
}
async function createVersion() {
  if (!selectedSystemId.value) return
  try {
    const response = await api.createIndicatorSystemVersion(selectedSystemId.value, '手工保存版本')
    lastVersion.value = response.data as Row
    message.value = `已保存版本 v${lastVersion.value.version}`
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '版本保存失败')
  }
}
watch(() => route.query.tab, syncTab)
watch(tab, () => { sectionPage.value = 1 })
watch(selectedSystemId, () => { nodePage.value = 1; loadNodes() })
watch(keyword, () => { page.value = 1 })
watch(nodePageCount, (count) => { nodePage.value = Math.min(nodePage.value, count) })
watch(taskSystemPageCount, (count) => { taskSystemPage.value = Math.min(taskSystemPage.value, count) })
watch(taskPageCount, (count) => { taskPage.value = Math.min(taskPage.value, count) })
onMounted(() => { syncTab(); loadAll() })
</script>

<template>
  <section class="page task-center">
    <header class="page-head compact-head">
      <div><p class="eyebrow">需要监测什么</p><h1>任务中心</h1></div>
      <span class="source-chip">统一感知要素编码</span>
    </header>
    <div class="tabs task-tabs">
      <button v-for="item in tabs" :key="item.key" class="tab" :class="{ active: tab === item.key }" @click="setTab(item.key)">{{ item.label }}</button>
    </div>
    <p v-if="loading" class="hint">正在加载指标体系…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <template v-if="tab === 'task-create'">
      <div v-if="sectionPage === 1" class="panel form-stack">
        <h3>{{ editingObservationTaskId ? '编辑观测任务' : '创建观测任务' }}</h3>
        <p class="muted">先保存任务基本信息，再到任务管理提交或继续配置指标。</p>
        <input v-model="observationTaskForm.name" placeholder="任务名称" />
        <textarea v-model="observationTaskForm.observationTarget" rows="3" placeholder="观测目标"></textarea>
        <textarea v-model="observationTaskForm.description" rows="2" placeholder="任务说明（可选）"></textarea>
        <div class="split"><select v-model="observationTaskForm.sceneId"><option value="">通用场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select><select v-model="observationTaskForm.priority"><option value="low">低优先级</option><option value="normal">普通优先级</option><option value="high">高优先级</option></select></div>
        <div class="split"><label>开始时间<input v-model="observationTaskForm.timeStart" type="datetime-local" /></label><label>结束时间<input v-model="observationTaskForm.timeEnd" type="datetime-local" /></label></div>
        <div class="form-actions"><button class="btn primary" :disabled="saving" @click="saveObservationTask">{{ editingObservationTaskId ? '保存修改' : '创建任务' }}</button><button v-if="editingObservationTaskId" class="btn ghost" type="button" @click="resetObservationTaskForm">取消编辑</button></div>
      </div>
      <section v-else class="panel collection-card">
        <header class="section-card-head"><h3>创建后的下一步</h3></header>
        <p class="muted">任务已保存后，可在“任务管理”提交，也可以回到这里继续编辑基本信息。</p>
        <button class="btn primary" type="button" @click="setTab('task-manage')">进入任务管理</button>
      </section>
    </template>

    <template v-else-if="tab === 'task-manage'">
      <section class="panel collection-card">
        <header class="section-card-head"><h3>任务列表</h3><span>共 {{ tasks.length }} 项</span></header>
        <p class="muted task-submit-hint">草稿任务提交前，请先在指标和业务配置中补齐指标、区域、尺度与分辨率。</p>
        <div v-if="pagedTasks.length" class="stack-list">
          <article v-for="item in pagedTasks" :key="item.id" class="record-card static">
            <span class="record-code">{{ item.code || `TASK-${item.id}` }}</span>
            <strong>{{ item.name }}</strong>
            <small>{{ taskStatusLabel(item.status) }} · {{ item.sceneName || '通用场景' }} · {{ item.observationTarget || '未填写观测目标' }}</small>
            <div class="record-actions"><button class="btn ghost tiny" type="button" @click="editObservationTask(item)">编辑</button><button v-if="['draft', 'created'].includes(String(item.status || '').toLowerCase())" class="btn tiny" type="button" @click="submitObservationTask(item)">提交</button><button v-if="['draft', 'created', 'submitted'].includes(String(item.status || '').toLowerCase())" class="btn ghost tiny" type="button" @click="cancelObservationTask(item)">取消</button><button v-if="String(item.status || '').toLowerCase() === 'submitted'" class="btn tiny" type="button" @click="transitionObservationTask(item, 'approve', '审核')">审核</button><button v-if="String(item.status || '').toLowerCase() === 'approved'" class="btn tiny" type="button" @click="transitionObservationTask(item, 'start', '启动')">启动</button><button v-if="String(item.status || '').toLowerCase() === 'running'" class="btn ghost tiny" type="button" @click="transitionObservationTask(item, 'pause', '暂停')">暂停</button><button v-if="['running', 'paused'].includes(String(item.status || '').toLowerCase())" class="btn tiny" type="button" @click="transitionObservationTask(item, 'complete', '完成确认')">完成确认</button><button v-if="String(item.status || '').toLowerCase() === 'completed'" class="btn ghost tiny" type="button" @click="transitionObservationTask(item, 'archive', '归档')">归档</button><button v-if="['draft', 'created'].includes(String(item.status || '').toLowerCase())" class="icon-danger" type="button" title="删除任务" @click="removeObservationTask(item)">×</button></div>
          </article>
        </div>
        <div v-else-if="!loading" class="empty-state">暂无任务。先创建一条任务，再进入指标体系建模。</div>
        <CardPager v-model:page="taskPage" kind="records" :pages="taskPageLabels" :summary="`共 ${tasks.length} 项`" label="任务分页" />
      </section>
    </template>

    <template v-else-if="tab === 'systems'">
      <div v-if="sectionPage === 1" class="panel form-stack">
        <h3>{{ editingSystemId ? '编辑基础指标体系' : '新建基础指标体系' }}</h3>
        <input v-model="systemForm.code" placeholder="体系编码" />
        <input v-model="systemForm.name" placeholder="体系名称" />
        <select v-model="systemForm.sceneId"><option value="">通用场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select>
        <textarea v-model="systemForm.description" rows="2" placeholder="体系说明"></textarea>
        <div class="form-actions"><button class="btn primary" :disabled="saving" @click="createSystem">{{ editingSystemId ? '保存修改' : '创建指标体系' }}</button><button v-if="editingSystemId" class="btn ghost" type="button" @click="cancelSystemEdit">取消编辑</button></div>
      </div>
      <section v-if="sectionPage === 2" class="panel collection-card">
        <header class="section-card-head"><h3>已有指标体系</h3><span>共 {{ filteredSystems.length }} 套</span></header>
        <div class="toolbar"><input v-model="keyword" type="search" placeholder="搜索编码、名称或说明" /></div>
        <div v-if="pagedSystems.length" class="stack-list">
          <div v-for="item in pagedSystems" :key="item.id" class="record-card" :class="{ selected: String(item.id) === selectedSystemId }">
            <button class="record-card-main" type="button" @click="selectedSystemId = String(item.id)"><span class="record-code">{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.status }} · v{{ item.currentVersion }}</small></button>
            <button class="btn ghost tiny" type="button" @click="editSystem(item)">编辑</button>
          </div>
        </div>
        <div v-else-if="!loading" class="empty-state">尚无指标体系。请先创建一套基础指标体系。</div>
        <CardPager v-model:page="page" kind="records" :pages="systemPageLabels" :summary="`共 ${filteredSystems.length} 套`" label="已有指标体系分页" />
      </section>
    </template>

    <template v-else-if="tab === 'modeling'">
      <div v-if="sectionPage === 1" class="panel form-stack">
        <h3>{{ editingNodeId ? '编辑体系节点' : '按六层结构添加节点' }}</h3>
        <select v-model="selectedSystemId"><option value="">选择指标体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select>
        <div class="split"><select v-model="nodeForm.level"><option value="object">对象</option><option value="domain">领域</option><option value="theme">主题</option><option value="subtheme">子主题</option><option value="item">指标项</option><option value="indicator">具体观测指标</option></select><select v-model="nodeForm.parentId"><option value="">无父节点</option><option v-for="item in nodes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></div>
        <div class="split"><input v-model="nodeForm.code" placeholder="节点编码" /><input v-model="nodeForm.name" placeholder="节点名称" /></div>
        <template v-if="nodeForm.level === 'indicator'">
          <select v-model="nodeForm.sensingElementId"><option value="">选择感知要素</option><option v-for="item in elements" :key="item.id" :value="String(item.id)">{{ item.name }}（{{ item.code }}）</option></select>
          <div class="split"><input v-model="nodeForm.temporalResolution" placeholder="时间分辨率" /><input v-model="nodeForm.spatialResolution" placeholder="空间分辨率" /></div>
          <div class="split"><input v-model="nodeForm.observationAccuracy" placeholder="观测精度" /><input v-model="nodeForm.monitoringFrequency" placeholder="监测频次" /></div>
          <input v-model="nodeForm.coverageRequirement" placeholder="覆盖要求" />
        </template>
        <div class="form-actions"><button class="btn primary" :disabled="saving || !selectedSystemId" @click="createNode">{{ editingNodeId ? '保存修改' : '创建节点' }}</button><button v-if="editingNodeId" class="btn ghost" type="button" @click="cancelNodeEdit">取消编辑</button></div>
      </div>
      <section v-if="sectionPage === 2" class="panel collection-card">
        <header class="section-card-head"><h3>体系节点</h3><span>共 {{ nodes.length }} 个</span></header>
        <div v-if="nodes.length" class="node-table">
          <div v-for="item in pagedNodes" :key="item.id" class="node-row">
            <div><span class="level-badge">{{ item.level }}</span><strong>{{ item.name }}</strong><small>{{ item.code }}<template v-if="item.sensingElementName"> · {{ item.sensingElementName }} · {{ item.temporalResolution }} · {{ item.spatialResolution }}</template></small></div>
            <div class="node-actions"><button class="btn ghost tiny" type="button" @click="editNode(item)">编辑</button><button class="icon-danger" title="删除" aria-label="删除节点" @click="removeNode(item)">×</button></div>
          </div>
        </div>
        <div v-else class="empty-state">当前体系没有节点。先从“对象”层开始建立结构。</div>
        <CardPager v-model:page="nodePage" kind="records" :pages="nodePageLabels" :summary="`共 ${nodes.length} 个`" label="体系节点分页" />
      </section>
    </template>

    <template v-else-if="tab === 'task-systems'">
      <div v-if="sectionPage === 1" class="panel form-stack">
        <h3>{{ editingTaskSystemId ? '编辑任务指标体系' : '建立任务指标体系' }}</h3>
        <input v-model="taskForm.name" placeholder="任务指标体系名称" />
        <template v-if="!editingTaskSystemId">
          <select v-model="taskForm.sceneId"><option value="">选择场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select>
          <select v-model="taskForm.observationTaskId"><option value="">暂不绑定任务草案</option><option v-for="item in tasks.filter((task) => !taskForm.sceneId || String(task.sceneId) === taskForm.sceneId)" :key="item.id" :value="String(item.id)">#{{ item.id }} · {{ item.name || item.code }}</option></select>
          <select v-model="selectedSystemId"><option value="">选择基础体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select>
        </template>
        <p v-else class="muted">场景、基础体系和关联任务保持不变。本次可修改名称和所选指标。</p>
        <div class="check-list"><label v-for="item in indicatorNodes" :key="item.id"><input v-model="selectedNodeIds" type="checkbox" :value="String(item.id)" /><span>{{ item.name }}<small>{{ item.sensingElementName }} · {{ item.temporalResolution }} · {{ item.spatialResolution }}</small></span></label></div>
        <div class="form-actions"><button class="btn primary" :disabled="saving" @click="createTaskSystem">{{ editingTaskSystemId ? '保存修改' : '创建任务指标草案' }}</button><button v-if="editingTaskSystemId" class="btn ghost" type="button" @click="cancelTaskSystemEdit">取消编辑</button></div>
      </div>
      <section v-if="sectionPage === 2" class="panel collection-card">
        <header class="section-card-head"><h3>任务指标草案</h3><span>共 {{ taskSystems.length }} 套</span></header>
        <div v-if="taskSystems.length" class="stack-list">
          <article v-for="item in pagedTaskSystems" :key="item.id" class="record-card static"><span class="record-code">{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.sourceType }} · {{ item.status }} · {{ item.selectedNodeIds?.length || 0 }} 项指标</small><div v-if="item.status === 'draft'" class="record-actions"><button class="btn ghost tiny" type="button" @click="editTaskSystem(item)">编辑</button><button class="btn tiny" @click="confirmTaskSystem(item)">人工确认</button></div></article>
        </div>
        <div v-else class="empty-state">尚无任务指标体系草案。</div>
        <CardPager v-model:page="taskSystemPage" kind="records" :pages="taskSystemPageLabels" :summary="`共 ${taskSystems.length} 套`" label="任务指标草案分页" />
      </section>
    </template>

    <template v-else>
      <div v-if="sectionPage === 1" class="panel trace-panel">
        <p class="eyebrow">可核验快照</p><h3>{{ selectedSystem?.name || '选择指标体系' }}</h3>
        <p class="muted">版本记录保存完整节点结构、来源和业务对象 ID，用于对比与回退依据。</p>
        <select v-model="selectedSystemId"><option value="">选择指标体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }} · v{{ item.currentVersion }}</option></select>
        <button class="btn primary" :disabled="!selectedSystemId" @click="createVersion">保存当前版本</button>
      </div>
      <section v-if="sectionPage === 2" class="panel collection-card">
        <header class="section-card-head"><h3>版本快照</h3><span>{{ lastVersion ? '已生成' : '等待保存' }}</span></header>
        <pre v-if="lastVersion" class="json-preview">{{ JSON.stringify(lastVersion, null, 2) }}</pre>
        <div v-else class="empty-state">保存版本后，这里会显示本次可核验快照。</div>
      </section>
    </template>
    <CardPager v-model:page="sectionPage" :pages="sectionPages" label="任务中心内容分页" />
  </section>
</template>

<style scoped>
.task-center { padding-bottom: 1rem; }
.compact-head { align-items: flex-start; }
.compact-head h1 { margin-bottom: 0; }
.source-chip { padding: .25rem .45rem; border: 1px solid #b7d7f7; color: var(--brand-dark); background: var(--brand-soft); border-radius: 999px; font-size: 10px; }
.task-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .25rem; }
.form-stack { display: grid; gap: .45rem; margin-top: .55rem; }
.form-stack h3 { margin: 0; font-size: 13px; color: #3a3a3c; }
.collection-card { margin-top: .6rem; }
.task-submit-hint { margin: -.15rem 0 .5rem; line-height: 1.45; }
.section-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
.section-card-head h3 { margin: 0; }
.section-card-head span { color: #6e6e73; font-size: 10px; white-space: nowrap; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }
.toolbar { margin: 0 0 .45rem; }
.toolbar input { width: 100%; }
.stack-list { display: grid; gap: .35rem; padding: .42rem; border-radius: 12px; background: #f3f4f6; }
.record-card { display: grid; gap: .12rem; width: 100%; padding: .5rem .55rem; text-align: left; border: 1px solid #e1e3e6; background: #fff; border-radius: 10px; cursor: pointer; }
.record-card-main { display: grid; gap: .12rem; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.record-card > .btn { justify-self: start; margin-top: .25rem; }
.record-card.selected { border-color: #b7d7f7; background: var(--brand-soft); }
.record-card.static { cursor: default; }
.form-actions, .record-actions, .node-actions { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; }
.record-card strong { color: #3a3a3c; font-size: 12px; }
.record-card small { color: #6e6e73; }
.record-code { font: 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; color: #68686d; }
.pager { display: flex; justify-content: center; gap: .5rem; margin: .6rem 0; font-size: 11px; }
.pager button { border: 0; background: transparent; color: var(--brand); }
.node-table { display: grid; gap: .35rem; padding: .42rem; border-radius: 12px; background: #f3f4f6; }
.node-row { display: flex; align-items: center; justify-content: space-between; gap: .35rem; padding: .5rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; }
.node-row > div { display: grid; gap: .1rem; min-width: 0; }
.node-row strong { font-size: 12px; color: #3a3a3c; }
.node-row small { overflow: hidden; text-overflow: ellipsis; color: #6e6e73; }
.level-badge { width: max-content; padding: .08rem .3rem; background: #f3f4f6; color: #515154; font-size: 9px; border-radius: 4px; }
.icon-danger { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #a33a31; font-size: 18px; cursor: pointer; }
.icon-danger:hover { background: #fef3f2; }
.check-list { max-height: 220px; overflow: auto; display: grid; gap: .3rem; padding: .35rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; }
.check-list label { display: flex; gap: .35rem; font-size: 12px; }
.check-list span { display: grid; }
.check-list small { color: #6e6e73; }
.empty-state { margin-top: .55rem; padding: 1rem .7rem; border: 1px dashed #cfd3d8; color: #6e6e73; text-align: center; font-size: 12px; background: #f6f7f8; }
.trace-panel { display: grid; gap: .5rem; }
.trace-panel h3, .trace-panel p { margin: 0; }
.json-preview { max-height: 320px; overflow: auto; white-space: pre-wrap; padding: .55rem; background: #142321; color: #dcebe7; border-radius: 5px; font-size: 10px; }
.ok-text { color: #247347; font-size: 12px; }
</style>
