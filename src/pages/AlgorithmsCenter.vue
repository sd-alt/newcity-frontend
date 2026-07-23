<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import {
  showShellAndFit,
  drawAlgoRegionOverlay,
  clearAlgoRegionOverlay,
  selectShellFeature,
  shellSelected,
  shellBubbleOpen,
  shellPickScreen,
  shellViewer,
  setShellVisibility,
  shellCounts,
  shellLoading,
} from '../gis/mapShell'
import { canByStatus, errMessage, pickId } from '../utils/errors'

const route = useRoute()
const router = useRouter()
const tab = ref('tasks')
const error = ref<string | null>(null)
const message = ref<string | null>(null)
const pending = ref(false)
const models = ref<Record<string, unknown>[]>([])
const versions = ref<Record<string, unknown>[]>([])
const tasks = ref<Record<string, unknown>[]>([])
const selectedTask = ref<Record<string, unknown> | null>(null)
const pollTimer = ref<number | null>(null)
const autoRefresh = ref(true)

function parseLogs(task: Record<string, unknown> | null): string[] {
  if (!task) return []
  const logs = task.logs ?? task.log ?? task.executionLogs
  if (Array.isArray(logs)) {
    return logs.map((x) => {
      if (typeof x === 'string') return x
      if (x && typeof x === 'object') {
        const row = x as Record<string, unknown>
        const time = String(row.time || row.at || '')
        const level = String(row.level || 'info')
        const msg = String(row.message || JSON.stringify(x))
        return [time, level, msg].filter(Boolean).join(' | ')
      }
      return String(x)
    })
  }
  if (typeof logs === 'string' && logs.trim()) return logs.split(/\r?\n/).filter(Boolean)
  const output = task.outputData || task.output
  if (output && typeof output === 'object') {
    const nested = (output as Record<string, unknown>).logs
    if (Array.isArray(nested)) return nested.map(String)
    if (typeof nested === 'string') return nested.split(/\r?\n/).filter(Boolean)
  }
  if (task.errorMessage) return [String(task.errorMessage)]
  return []
}

function resultStage(task: Record<string, unknown>): string {
  const output = (task.outputData || task.output || {}) as Record<string, unknown>
  const rm = (output.resultManagement || task.resultManagement || {}) as Record<string, unknown>
  if (rm.archivedAt || rm.status === 'archived') return 'archived'
  if (rm.publishedAt || rm.status === 'published') return 'published'
  if (rm.verifiedAt || rm.verified === true || rm.status === 'verified') return 'verified'
  if (String(task.status) === 'succeeded') return 'ready'
  return 'none'
}

function canVerify(task: Record<string, unknown>) {
  // 仅成功且尚未校验/发布/归档时可校验
  return String(task.status) === 'succeeded' && resultStage(task) === 'ready'
}
function canPublishResult(task: Record<string, unknown>) {
  // 必须先校验再发布
  return String(task.status) === 'succeeded' && resultStage(task) === 'verified'
}
function canArchiveResult(task: Record<string, unknown>) {
  return ['succeeded', 'failed', 'cancelled'].includes(String(task.status)) && resultStage(task) !== 'archived'
}

const selectedLogs = computed(() => parseLogs(selectedTask.value))
const selectedProgress = computed(() => Number(selectedTask.value?.progress ?? 0))



function hasActiveTasks() {
  return tasks.value.some((t) => ['pending', 'running'].includes(String(t.status)))
}

function stopPolling() {
  if (pollTimer.value != null) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

function startPolling() {
  stopPolling()
  if (!autoRefresh.value) return
  pollTimer.value = window.setInterval(async () => {
    if (!autoRefresh.value) return
    try {
      await load()
      if (selectedTask.value?.id != null) {
        const latest = tasks.value.find((t) => String(t.id) === String(selectedTask.value?.id))
        if (latest) selectedTask.value = latest
      }
      if (!hasActiveTasks()) stopPolling()
    } catch {
      // ignore poll errors
    }
  }, 2000)
}

function clearAlerts() {
  error.value = null
  message.value = null
}

const modelForm = ref({
  code: '',
  name: '',
  modelType: 'analysis',
  currentVersion: '1.0.0',
  responsibleParty: 'newcity',
  description: '',
  implementationReference: 'builtin:station-coverage',
  autoPublish: true,
})
const versionForm = ref({
  algorithmModelId: '',
  version: '1.0.0',
  implementationReference: 'builtin:station-coverage',
  releaseNotes: '',
  autoPublish: true,
})
const taskForm = ref({
  code: '',
  algorithmVersionId: '',
  inputDataText: '{"platformId":50,"studyAreaWkt":"POLYGON((114 22,115 22,115 23,114 23,114 22))"}',
  parametersText: '{}',
})

const tabs = [
  { key: 'models', label: '算法增删改查' },
  { key: 'tasks', label: '处理任务创建' },
  { key: 'run', label: '调度与执行' },
  { key: 'monitor', label: '过程监控' },
  { key: 'results', label: '结果管理' },
]

const activeVersions = computed(() =>
  versions.value.filter((v) => String(v.status) === 'active' || String(v.status) === 'draft'),
)

async function setTab(key: string) {
  tab.value = key
  await router.replace({ path: '/algorithms', query: { tab: key } })
}
function syncTab() {
  const t = route.query.tab
  if (typeof t === 'string' && tabs.some((x) => x.key === t)) tab.value = t
}

async function load() {
  error.value = null
  try {
    const [m, v, t] = await Promise.all([
      api.listAlgorithmModels(),
      api.listModelVersions(),
      api.listProcessingTasks(),
    ])
    models.value = m.data
    versions.value = v.data
    tasks.value = [...t.data].sort((a, b) => {
      const rank = (x: Record<string, unknown>) => {
        const st = String(x.status || '')
        const out = (x.outputData || x.output_data || {}) as Record<string, unknown>
        const inp = (x.inputData || x.input_data || {}) as Record<string, unknown>
        const hasGeo = Boolean(out.coverageWkt || out.resultWkt || inp.studyAreaWkt)
        if (st === 'succeeded' && hasGeo) return 0
        if (st === 'succeeded') return 1
        if (st === 'running') return 2
        if (st === 'failed') return 4
        return 3
      }
      return rank(a) - rank(b)
    })
    if (versionForm.value.algorithmModelId === '' && models.value[0]) {
      versionForm.value.algorithmModelId = pickId(models.value[0])
    }
    if (taskForm.value.algorithmVersionId === '') {
      const preferred = versions.value.find((x) => String(x.status) === 'active') || versions.value[0]
      if (preferred) taskForm.value.algorithmVersionId = pickId(preferred)
    }
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
}

async function ensureVersionPublished(modelId: string | number, version: string, impl: string, notes: string) {
  const created = await api.createModelVersion({
    algorithmModelId: Number(modelId),
    version,
    implementationReference: impl || undefined,
    releaseNotes: notes || undefined,
  })
  const versionId = pickId(created.data as Record<string, unknown>)
  if (versionId) {
    await api.publishModelVersion(versionId)
  }
  return versionId
}

async function createModel() {
  if (modelForm.value.code === '' || modelForm.value.name === '') {
    error.value = '请填写算法编码和名称'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    const created = await api.createAlgorithmModel({
      code: modelForm.value.code,
      name: modelForm.value.name,
      modelType: modelForm.value.modelType,
      currentVersion: modelForm.value.currentVersion,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      parameterSchema: { type: 'object' },
      responsibleParty: modelForm.value.responsibleParty,
      description: modelForm.value.description || undefined,
      implementationReference: modelForm.value.implementationReference || undefined,
    })
    const modelId = pickId(created.data as Record<string, unknown>)
    if (modelId && modelForm.value.autoPublish) {
      await ensureVersionPublished(
        modelId,
        modelForm.value.currentVersion || '1.0.0',
        modelForm.value.implementationReference,
        '初始版本自动发布',
      )
      message.value = '算法模型已创建，并自动注册/发布版本'
    } else {
      message.value = '算法模型已创建（未自动发布版本）'
    }
    modelForm.value.code = ''
    modelForm.value.name = ''
    modelForm.value.description = ''
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建失败')
  } finally {
    pending.value = false
  }
}

async function createVersionOnly() {
  if (versionForm.value.algorithmModelId === '' || versionForm.value.version === '') {
    error.value = '请选择算法模型并填写版本号'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    if (versionForm.value.autoPublish) {
      await ensureVersionPublished(
        versionForm.value.algorithmModelId,
        versionForm.value.version,
        versionForm.value.implementationReference,
        versionForm.value.releaseNotes,
      )
      message.value = '版本已创建并发布'
    } else {
      await api.createModelVersion({
        algorithmModelId: Number(versionForm.value.algorithmModelId),
        version: versionForm.value.version,
        implementationReference: versionForm.value.implementationReference || undefined,
        releaseNotes: versionForm.value.releaseNotes || undefined,
      })
      message.value = '版本已创建（草稿）'
    }
    await load()
  } catch (err) {
    error.value = errMessage(err, '创建版本失败')
  } finally {
    pending.value = false
  }
}

async function publishVersion(id: unknown) {
  try {
    await api.publishModelVersion(String(id))
    message.value = '版本已发布'
    await load()
  } catch (err) {
    error.value = errMessage(err, '发布失败')
  }
}

async function retireVersion(id: unknown) {
  try {
    await api.retireModelVersion(String(id))
    message.value = '版本已退役'
    await load()
  } catch (err) {
    error.value = errMessage(err, '退役失败')
  }
}

async function removeModel(id: unknown) {
  if (window.confirm('确认删除算法模型？') === false) return
  try {
    await api.deleteAlgorithmModel(String(id))
    message.value = '已删除'
    await load()
  } catch (err) {
    error.value = errMessage(err, '删除失败')
  }
}

async function enableModel(id: unknown) {
  try {
    await api.enableAlgorithmModel(String(id))
    message.value = '已启用'
    await load()
  } catch (err) {
    error.value = errMessage(err, '启用失败')
  }
}

async function disableModel(id: unknown) {
  try {
    await api.disableAlgorithmModel(String(id))
    message.value = '已停用'
    await load()
  } catch (err) {
    error.value = errMessage(err, '停用失败')
  }
}

async function createTask() {
  if (taskForm.value.code === '' || taskForm.value.algorithmVersionId === '') {
    error.value = '请填写任务编码并选择算法版本'
    return
  }
  let inputData: unknown = {}
  let parameters: unknown = {}
  try {
    inputData = JSON.parse(taskForm.value.inputDataText || '{}')
    parameters = JSON.parse(taskForm.value.parametersText || '{}')
  } catch {
    error.value = '输入数据/参数必须是合法 JSON'
    return
  }
  pending.value = true
  clearAlerts()
  try {
    await api.createProcessingTask({
      code: taskForm.value.code,
      algorithmVersionId: Number(taskForm.value.algorithmVersionId),
      inputData,
      parameters,
    })
    message.value = '处理任务已创建'
    try { await showAlgoMap() } catch { /* map refresh optional */ }
    taskForm.value.code = ''
    await load()
    await setTab('run')
  } catch (err) {
    error.value = errMessage(err, '创建任务失败（需选择已发布 active 版本）')
  } finally {
    pending.value = false
  }
}

async function runTask(id: unknown) {
  clearAlerts()
  try {
    await api.runProcessingTask(String(id), { asyncMode: true })
    message.value = '任务已提交后台执行，监控页可查看进度'
    await load()
    startPolling()
    await setTab('monitor')
  } catch (err) {
    error.value = errMessage(err, '执行失败')
  }
}

async function cancelTask(id: unknown) {
  try {
    await api.cancelProcessingTask(String(id))
    message.value = '已终止'
    await load()
  } catch (err) {
    error.value = errMessage(err, '终止失败')
  }
}

async function requeueTask(id: unknown) {
  try {
    await api.requeueProcessingTask(String(id))
    message.value = '已重新排队'
    await load()
  } catch (err) {
    error.value = errMessage(err, '重新排队失败')
  }
}

async function pauseTask(id: unknown) {
  try {
    await api.pauseProcessingTask(String(id))
    message.value = '已暂停'
    await load()
    await inspectTask(id)
  } catch (err) {
    error.value = errMessage(err, '暂停失败')
  }
}

async function resumeTask(id: unknown) {
  clearAlerts()
  try {
    await api.resumeProcessingTask(String(id), { autoRun: true })
    message.value = '任务已恢复并继续后台执行'
    await load()
    startPolling()
    await setTab('monitor')
  } catch (err) {
    error.value = errMessage(err, '恢复失败')
  }
}

async function downloadResult(id: unknown) {
  try {
    const text = await api.downloadProcessingResult(String(id))
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'processing-task-' + String(id) + '.json'
    a.click()
    URL.revokeObjectURL(url)
    message.value = '结果已下载'
  } catch (err) {
    error.value = errMessage(err, '下载失败')
  }
}

async function verifyResult(id: unknown) {
  try {
    await api.verifyProcessingTask(String(id), { note: '前端校验通过' })
    message.value = '结果已校验'
    await load()
    await inspectTask(id)
  } catch (err) {
    error.value = errMessage(err, '校验失败')
  }
}

async function publishResult(id: unknown) {
  try {
    await api.publishProcessingResult(String(id))
    message.value = '结果已发布'
    await load()
    await inspectTask(id)
  } catch (err) {
    error.value = errMessage(err, '发布失败（需先校验）')
  }
}

async function archiveResult(id: unknown) {
  if (window.confirm('确认归档该处理结果？归档后不可再改关联。') === false) return
  try {
    await api.archiveProcessingResult(String(id))
    message.value = '结果已归档'
    await load()
    await inspectTask(id)
  } catch (err) {
    error.value = errMessage(err, '归档失败')
  }
}

const linkForm = ref({
  taskId: '',
  observationDataIds: '',
  planningTaskIds: '',
  indicatorInstanceIds: '',
  externalChannel: '',
})

function parseIdList(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
}

async function linkResultContext() {
  if (linkForm.value.taskId === '') {
    error.value = '请先填写或选中处理任务 ID'
    return
  }
  try {
    await api.linkProcessingContext(linkForm.value.taskId, {
      observationDataIds: parseIdList(linkForm.value.observationDataIds),
      planningTaskIds: parseIdList(linkForm.value.planningTaskIds),
      indicatorInstanceIds: parseIdList(linkForm.value.indicatorInstanceIds),
      externalChannel: linkForm.value.externalChannel || '',
    })
    message.value = '业务关联已保存'
    await load()
    await inspectTask(linkForm.value.taskId)
  } catch (err) {
    error.value = errMessage(err, '关联失败')
  }
}

function resultMeta(t: Record<string, unknown>) {
  const out = t.outputData as Record<string, unknown> | undefined
  const rm = out && typeof out === 'object' ? (out.resultManagement as Record<string, unknown> | undefined) : undefined
  if (!rm) return '-'
  const flags = [
    rm.verified ? '已校验' : null,
    rm.published ? '已发布' : null,
    rm.archived ? '已归档' : null,
  ].filter(Boolean)
  return flags.length ? flags.join('/') : '未管理'
}

async function inspectTask(id: unknown) {
  try {
    error.value = null
    const res = await api.getProcessingTask(String(id))
    selectedTask.value = res.data as Record<string, unknown>
    presentAlgoSelection(selectedTask.value || {}, '', '')
    await locateLinkedOnMap(selectedTask.value || {})
  } catch (err) {
    error.value = errMessage(err, '读取任务详情失败')
  }
}

async function removeTask(id: unknown) {
  if (window.confirm('确认删除该处理任务？') === false) return
  try {
    await api.deleteProcessingTask(String(id))
    if (selectedTask.value && String(selectedTask.value.id) === String(id)) selectedTask.value = null
    message.value = '任务已删除'
    await load()
  } catch (err) {
    error.value = errMessage(err, '删除失败')
  }
}

onMounted(async () => {
  syncTab()
  await load()
  if (hasActiveTasks()) startPolling()
})
onBeforeUnmount(() => {
  stopPolling()
})
watch(() => route.query.tab, syncTab)

async function clearAlgoRegionOnMap() {
  await clearAlgoRegionOverlay()
  message.value = '已清除算法区域图层'
}

async function showAlgoMap() {
  await showShellAndFit('all', '/algorithms')
  setShellVisibility({ showSensors: true, showData: true, showTasks: true })
  message.value = `已刷新算法相关图层（任务 ${shellCounts.tasks} / 数据 ${shellCounts.data} / 传感器 ${shellCounts.sensors}）`
}


function presentAlgoSelection(task: Record<string, unknown>, studyWkt: string, resultWkt: string) {
  const id = String(task.id ?? '')
  const code = String(task.code || task.name || id)
  const status = String(task.status || '-')
  shellSelected.value = {
    kind: 'unknown',
    id,
    name: '算法任务 ' + code,
    description: [
      '状态: ' + status,
      '进度: ' + String(task.progress ?? '-'),
      studyWkt ? '输入区域: 有' : '输入区域: 无',
      resultWkt ? '结果区域: 有' : '结果区域: 无',
      'ID: ' + id,
    ].join('\n'),
  }
  const viewer = shellViewer.value
  if (viewer && !viewer.isDestroyed()) {
    const canvas = viewer.scene.canvas
    shellPickScreen.value = {
      x: Math.round(canvas.clientWidth * 0.5),
      y: Math.round(canvas.clientHeight * 0.35),
    }
  } else {
    shellPickScreen.value = { x: 320, y: 180 }
  }
  shellBubbleOpen.value = true
}

async function locateLinkedOnMap(task: Record<string, unknown>) {
  if (!task || Object.keys(task).length === 0) {
    error.value = '请先选择处理任务'
    return
  }
  const ctx = (task.context || task.linkContext || task) as Record<string, unknown>
  const input = (task.inputData || task.input_data || ctx.inputData || {}) as Record<string, unknown>
  const output = (task.outputData || task.output_data || ctx.outputData || {}) as Record<string, unknown>
  const studyWkt = String(
    input.studyAreaWkt || input.spatialWkt || input.researchAreaWkt || input.geometryWkt || '',
  ).trim()
  const resultWkt = String(
    output.coverageWkt ||
      output.resultWkt ||
      output.spatialWkt ||
      output.geometryWkt ||
      output.studyAreaWkt ||
      '',
  ).trim()

  await showShellAndFit('all', '/algorithms')

  // 1) 输入/结果几何优先上图
  if (studyWkt || resultWkt) {
    try {
      await drawAlgoRegionOverlay({
        inputWkt: studyWkt,
        resultWkt: resultWkt,
        fit: true,
        inputLabel: `算法输入 #${task.id || ''}`,
        resultLabel: `算法结果 #${task.id || ''}`,
      })
      presentAlgoSelection(task, studyWkt, resultWkt)
    } catch {
      /* optional */
    }
  } else {
    presentAlgoSelection(task, studyWkt, resultWkt)
  }

  const planRaw = ctx.planningTaskIds ?? ctx.planning_task_ids ?? input.planningTaskIds ?? ''
  const dataRaw = ctx.observationDataIds ?? ctx.observation_data_ids ?? input.observationDataIds ?? ''
  const planList = Array.isArray(planRaw)
    ? planRaw
    : String(planRaw || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
  const dataList = Array.isArray(dataRaw)
    ? dataRaw
    : String(dataRaw || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)

  if (planList.length) {
    const id = String(planList[0])
    const ok = await selectShellFeature('task', id, { openBubble: false, fly: !studyWkt })
    presentAlgoSelection(task, studyWkt, resultWkt)
    try {
      const tres = await api.getTask(id)
      const twkt = String((tres.data as { researchAreaWkt?: string })?.researchAreaWkt || '')
      if (twkt && !studyWkt) {
        await drawAlgoRegionOverlay({ inputWkt: twkt, fit: true, inputLabel: `关联任务区域 #${id}` })
      }
    } catch {
      /* optional */
    }
    message.value = ok || studyWkt || resultWkt
      ? `已定位算法关联任务 #${id}` + (studyWkt || resultWkt ? '，并绘制算法区域' : '')
      : `已上图；未找到关联任务 #${id} 空间范围`
    return
  }

  if (dataList.length) {
    const id = String(dataList[0])
    const ok = await selectShellFeature('data', id, { openBubble: false, fly: !studyWkt })
    presentAlgoSelection(task, studyWkt, resultWkt)
    message.value = ok || studyWkt || resultWkt
      ? `已定位关联监测数据 #${id}`
      : `已上图；未找到关联数据 #${id}`
    return
  }

  // link form fallback
  const linkPlan = String((linkForm?.value?.planningTaskIds as string) || '').trim()
  const linkData = String((linkForm?.value?.observationDataIds as string) || '').trim()
  if (linkPlan) {
    const id = String(linkPlan.split(',')[0] || '').trim()
    await selectShellFeature('task', id, { openBubble: true, fly: true })
    message.value = `已按表单关联任务 #${id} 定位`
    return
  }
  if (linkData) {
    const id = String(linkData.split(',')[0] || '').trim()
    await selectShellFeature('data', id, { openBubble: true, fly: true })
    message.value = `已按表单关联数据 #${id} 定位`
    return
  }

  if (studyWkt || resultWkt) {
    message.value = `已绘制算法区域（输入${studyWkt ? '有' : '无'} / 结果${resultWkt ? '有' : '无'}）`
    return
  }

  // platform point fallback
  const platformId = input.platformId ?? input.platform_id
  if (platformId != null) {
    const ok = await selectShellFeature('sensor', String(platformId), { openBubble: true, fly: true })
    message.value = ok
      ? `已定位关联传感器平台 #${platformId}`
      : `未找到传感器平台 #${platformId}`
    return
  }

  message.value = '当前任务无空间字段；请在输入数据中填写 studyAreaWkt，或关联观测任务/数据'
}


</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">算法处理中心</p>
        <h1>算法模型与处理任务</h1>
        <p class="muted">闭环：创建模型 → 注册并发布版本 → 创建处理任务 → 调度执行 → 监控 → 查看结果</p>
      </div>
      <div class="form-row">
        <button class="btn ghost" type="button" :disabled="shellLoading" @click="showAlgoMap">相关图层上图</button>
      <button class="btn ghost" type="button" :disabled="shellLoading" @click="locateLinkedOnMap((selectedTask || {}) as Record<string, unknown>)">关联对象上图</button>
      <button class="btn ghost" type="button" :disabled="shellLoading" @click="clearAlgoRegionOnMap">清除算法区域</button>
      </div>
    </header>

    <p v-if="error" class="alert error">{{ error }}</p>
    <p v-if="message" class="alert ok">{{ message }}</p>

    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="setTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <section v-show="tab === 'models'" class="panel">
      <h2>算法增删改查 + 版本管理</h2>
      <div class="form-row">
        <label>编码<input v-model="modelForm.code" placeholder="ALG-DEMO-01" /></label>
        <label>名称<input v-model="modelForm.name" placeholder="覆盖分析" /></label>
        <label>类型
          <select v-model="modelForm.modelType">
            <option value="analysis">analysis</option>
            <option value="planning">planning</option>
            <option value="processing">processing</option>
          </select>
        </label>
        <label>初始版本<input v-model="modelForm.currentVersion" /></label>
        <label>责任方<input v-model="modelForm.responsibleParty" /></label>
        <label>实现引用
          <select v-model="modelForm.implementationReference">
            <option value="builtin:station-coverage">builtin:station-coverage</option>
            <option value="builtin:satellite-propagation">builtin:satellite-propagation</option>
            <option value="builtin:uav-route-plan">builtin:uav-route-plan</option>
          </select>
        </label>
        <label class="check"><input v-model="modelForm.autoPublish" type="checkbox" /> 创建后自动发布版本</label>
        <button class="btn" type="button" :disabled="pending" @click="createModel">创建模型</button>
      </div>

      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>名称</th><th>版本</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="m in models" :key="String(m.id)">
            <td>{{ m.id }}</td>
            <td>{{ m.code }}</td>
            <td>{{ m.name }}</td>
            <td>{{ m.currentVersion || '-' }}</td>
            <td>{{ m.status || '-' }}</td>
            <td class="ops">
              <button class="btn ghost" type="button" @click="enableModel(m.id)">启用</button>
              <button class="btn ghost" type="button" @click="disableModel(m.id)">停用</button>
              <button class="btn ghost" type="button" @click="removeModel(m.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>注册算法版本</h3>
      <div class="form-row">
        <label>模型
          <select v-model="versionForm.algorithmModelId">
            <option value="">请选择</option>
            <option v-for="m in models" :key="'vm'+m.id" :value="String(m.id)">#{{ m.id }} {{ m.code }}</option>
          </select>
        </label>
        <label>版本号<input v-model="versionForm.version" /></label>
        <label>实现引用
          <select v-model="versionForm.implementationReference">
            <option value="builtin:station-coverage">builtin:station-coverage</option>
            <option value="builtin:satellite-propagation">builtin:satellite-propagation</option>
            <option value="builtin:uav-route-plan">builtin:uav-route-plan</option>
          </select>
        </label>
        <label>说明<input v-model="versionForm.releaseNotes" /></label>
        <label class="check"><input v-model="versionForm.autoPublish" type="checkbox" /> 创建后发布</label>
        <button class="btn" type="button" :disabled="pending" @click="createVersionOnly">创建版本</button>
      </div>

      <table class="table">
        <thead><tr><th>ID</th><th>模型</th><th>版本</th><th>状态</th><th>实现</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="'v'+v.id">
            <td>{{ v.id }}</td>
            <td>{{ v.modelCode || v.algorithmModelId }}</td>
            <td>{{ v.version }}</td>
            <td>{{ v.status }}</td>
            <td><code>{{ v.implementationReference || '-' }}</code></td>
            <td class="ops">
              <button v-if="v.status === 'draft'" class="btn ghost" type="button" @click="publishVersion(v.id)">发布</button>
              <button v-if="v.status === 'active'" class="btn ghost" type="button" @click="retireVersion(v.id)">退役</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="tab === 'tasks'" class="panel">
      <h2>处理任务创建</h2>
      <p class="muted">必须选择状态为 active 的算法版本；输入数据与参数为 JSON。</p>
      <div class="form-row">
        <label>任务编码<input v-model="taskForm.code" placeholder="PROC-001" /></label>
        <label>算法版本
          <select v-model="taskForm.algorithmVersionId">
            <option value="">请选择</option>
            <option v-for="v in activeVersions" :key="'av'+v.id" :value="String(v.id)">
              #{{ v.id }} {{ v.modelCode }}@{{ v.version }} ({{ v.status }})
            </option>
          </select>
        </label>
        <label>输入 JSON<textarea v-model="taskForm.inputDataText" rows="3" style="min-height:4rem"></textarea></label>
        <label>参数 JSON<textarea v-model="taskForm.parametersText" rows="2" style="min-height:3rem"></textarea></label>
        <button class="btn" type="button" :disabled="pending" @click="createTask">创建任务</button>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>状态</th><th>版本</th><th>进度</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="String(t.id)" class="row-click" :class="{ selected: selectedTask && String(selectedTask.id) === String(t.id) }" @click="inspectTask(t.id)">
            <td>{{ t.id }}</td>
            <td>{{ t.code || t.name }}</td>
            <td>{{ t.status || '-' }}</td>
            <td>{{ t.algorithmVersionId || '-' }}</td>
            <td>{{ t.progress ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="tab === 'run'" class="panel">
      <h2>任务调度与执行</h2>
      <p class="muted">支持：启动执行、暂停、恢复、终止、重新排队（对应文档：提交/排队/启动/暂停/恢复/终止/重新执行）。</p>
      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>状态</th><th>进度</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="'r'+t.id" class="row-click" :class="{ selected: selectedTask && String(selectedTask.id) === String(t.id) }" @click="inspectTask(t.id)">
            <td>{{ t.id }}</td>
            <td>{{ t.code || t.name }}</td>
            <td>{{ t.status || '-' }}</td>
            <td>{{ t.progress ?? 0 }}%</td>
            <td class="ops">
              <button class="btn" type="button" :disabled="canByStatus(t.status, ['pending']) === false" @click.stop="runTask(t.id)">执行</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(t.status, ['running']) === false" @click.stop="pauseTask(t.id)">暂停</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(t.status, ['paused']) === false" @click.stop="resumeTask(t.id)">恢复</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(t.status, ['pending', 'running', 'paused']) === false" @click.stop="cancelTask(t.id)">终止</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(t.status, ['failed', 'succeeded', 'cancelled', 'paused']) === false" @click.stop="requeueTask(t.id)">重新排队</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="tab === 'monitor'" class="panel">
      <h2>处理过程监控</h2>
      <p class="muted">展示运行状态、执行进度、处理日志、异常信息。后台执行时自动轮询（2s）。</p>
      <div class="form-row">
        <button class="btn ghost" type="button" @click="load">刷新状态</button>
        <label class="check"><input v-model="autoRefresh" type="checkbox" @change="autoRefresh ? startPolling() : stopPolling()" /> 自动刷新</label>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>状态</th><th>进度</th><th>开始</th><th>结束</th><th>异常</th><th>详情</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="'m'+t.id" class="row-click" :class="{ selected: selectedTask && String(selectedTask.id) === String(t.id), active: selectedTask && selectedTask.id === t.id }" @click="inspectTask(t.id)">
            <td>{{ t.id }}</td>
            <td>{{ t.code || t.name }}</td>
            <td>{{ t.status || 'unknown' }}</td>
            <td>
              <div class="progress-wrap">
                <div class="progress-bar" :style="{ width: Math.max(0, Math.min(100, Number(t.progress || 0))) + '%' }"></div>
              </div>
              <span class="muted">{{ t.progress ?? 0 }}%</span>
            </td>
            <td>{{ t.startedAt || '-' }}</td>
            <td>{{ t.finishedAt || t.updatedAt || '-' }}</td>
            <td class="clamp">{{ t.errorMessage || '-' }}</td>
            <td><button class="btn ghost" type="button" @click="inspectTask(t.id)">查看详情</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="selectedTask" class="panel soft" style="margin-top:0.8rem">
        <h3>任务 #{{ selectedTask.id }} 监控详情</h3>
        <p>状态 {{ selectedTask.status }} · 结果阶段 {{ resultStage(selectedTask) }} · 错误 {{ selectedTask.errorMessage || '无' }}</p>
        <div class="progress-wrap large">
          <div class="progress-bar" :style="{ width: Math.max(0, Math.min(100, selectedProgress)) + '%' }"></div>
        </div>
        <p class="muted">进度 {{ selectedProgress }}%</p>
        <h4>处理日志</h4>
        <ul v-if="selectedLogs.length" class="log-list">
          <li v-for="(line, i) in selectedLogs" :key="'lg'+i"><code>{{ line }}</code></li>
        </ul>
        <p v-else class="muted">暂无结构化日志；可查看原始输出。</p>
        <details>
          <summary>原始输出 / 资源占用字段</summary>
          <pre class="result-pre">{{ JSON.stringify({ logs: selectedTask.logs, output: selectedTask.outputData || selectedTask.output, resourceUsage: selectedTask.resourceUsage || selectedTask.metrics }, null, 2) }}</pre>
        </details>
      </div>
    </section>

    <section v-show="tab === 'results'" class="panel">
      <h2>处理结果管理</h2>
      <p class="muted">文档要求：查看、校验、下载、发布、归档，并与监测数据/观测任务/指标实例建立关联。执行路径：成功 → 校验 → 发布 →（可选）归档。</p>
      <table class="table">
        <thead><tr><th>ID</th><th>编码</th><th>状态</th><th>结果管理</th><th>输出摘要</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="'res'+t.id" class="row-click" :class="{ selected: selectedTask && String(selectedTask.id) === String(t.id) }" @click="inspectTask(t.id)">
            <td>{{ t.id }}</td>
            <td>{{ t.code }}</td>
            <td>{{ t.status }}</td>
            <td>{{ resultStage(t) }} / {{ resultMeta(t) }}</td>
            <td><code>{{ JSON.stringify(t.outputData || t.result || t.output || t.errorMessage || {}).toString().slice(0, 100) }}</code></td>
            <td class="ops">
              <button class="btn ghost" type="button" @click="inspectTask(t.id); linkForm.taskId = String(t.id)">查看</button>
              <button class="btn ghost" type="button" :disabled="!canVerify(t)" @click="verifyResult(t.id)">校验</button>
              <button class="btn ghost" type="button" :disabled="!canPublishResult(t)" @click="publishResult(t.id)">发布</button>
              <button class="btn ghost" type="button" @click="downloadResult(t.id)">下载</button>
              <button class="btn ghost" type="button" :disabled="!canArchiveResult(t)" @click="archiveResult(t.id)">归档结果</button>
              <button class="btn ghost" type="button" :disabled="canByStatus(t.status, ['running'])" @click="removeTask(t.id)">删除任务</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>建立业务关联</h3>
      <div class="form-row">
        <label>处理任务ID<input v-model="linkForm.taskId" placeholder="选中任务后自动填入" /></label>
        <label>监测数据IDs<input v-model="linkForm.observationDataIds" placeholder="1,2,3" /></label>
        <label>观测任务IDs<input v-model="linkForm.planningTaskIds" placeholder="规划任务 id" /></label>
        <label>指标实例IDs<input v-model="linkForm.indicatorInstanceIds" placeholder="实例 id" /></label>
        <label>外发渠道备注<input v-model="linkForm.externalChannel" placeholder="如：内部目录/业务系统（记录备注，非自动推送）" /></label>
        <button class="btn" type="button" @click="linkResultContext">保存关联</button>
      </div>
      <pre v-if="selectedTask" class="result-pre">{{ JSON.stringify(selectedTask, null, 2) }}</pre>
    </section>
  </section>
</template>
