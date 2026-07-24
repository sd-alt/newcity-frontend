<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import {
  clearAssociationLinks,
  drawPlanningCoverageOverlay,
  clearPlanningCoverageOverlay,
  drawAssociationLinks,
  selectShellFeature,
  setShellVisibility,
  shellCounts,
  shellSelected,
  shellStatus,
  showPlanningWorkspace,
} from '../gis/mapShell'
import { canByStatus, errMessage, isoNow, pickId } from '../utils/errors'
import { useAuthStore } from '../stores/auth'
import { mapDrawGeometry } from '../gis/mapTools'
import { wktToGeoJson, type SimpleGeometry } from '../gis/wkt'

type StepKey =
  | 'create'
  | 'submit'
  | 'reverse'
  | 'candidates'
  | 'basic'
  | 'optimize'
  | 'supplement'
  | 'evaluate'
  | 'output'

const STEP_ORDER: StepKey[] = [
  'create',
  'submit',
  'reverse',
  'candidates',
  'basic',
  'optimize',
  'supplement',
  'evaluate',
  'output',
]
const STEPS: { key: StepKey; title: string; desc: string }[] = [
  { key: 'create', title: '1. 创建任务', desc: '任务建模 + 指标选择' },
  { key: 'submit', title: '2. 提交任务', desc: '进入可关联状态' },
  { key: 'reverse', title: '3. 需求反算', desc: '反算所需传感器类型/数量' },
  { key: 'candidates', title: '4. 候选与评分', desc: '筛选候选并展示评分依据' },
  { key: 'basic', title: '5. 基础关联', desc: '建立初步关联' },
  { key: 'optimize', title: '6. 优化关联', desc: '优化资源组合' },
  { key: 'supplement', title: '7. 增补关联', desc: '补足覆盖不足' },
  { key: 'evaluate', title: '8. 满足度评估', desc: '关联后覆盖/精度核查' },
  { key: 'output', title: '9. 规划输出', desc: '生成输出方案' },
]

const { user, setLastTaskId } = useAuthStore()
const router = useRouter()
const route = useRoute()
const tab = ref('tasks')
const tabs = [
  { key: 'tasks', label: '任务建模' },
  { key: 'flow', label: '需求与关联' },
  { key: 'candidates', label: '候选与评分' },
  { key: 'plans', label: '方案管理' },
]

const instances = ref<Record<string, unknown>[]>([])
const scales = ref<Record<string, unknown>[]>([])
const tasks = ref<Record<string, unknown>[]>([])
const plans = ref<Record<string, unknown>[]>([])
const lastCopiedPlanId = ref<string | number | null>(null)

function sortPlans(list: Record<string, unknown>[]) {
  const rank = (status: unknown) => {
    const s = String(status || '').toLowerCase()
    if (s === 'draft' || s === 'created') return 0
    if (s === 'approved') return 1
    if (s.includes('complete') || s.includes('basic')) return 2
    if (s === 'published') return 3
    if (s === 'archived') return 4
    return 5
  }
  return [...list].sort((a, b) => {
    const d = rank(a.status) - rank(b.status)
    if (d !== 0) return d
    return Number(b.id || 0) - Number(a.id || 0)
  })
}
const candidateRows = ref<Record<string, unknown>[]>([])
const excludedRows = ref<Record<string, unknown>[]>([])
const candidateMeta = ref<Record<string, unknown> | null>(null)
const reverseResult = ref<unknown>(null)
const evalResult = ref<unknown>(null)
const outputResult = ref<unknown>(null)
const planResult = ref<unknown>(null)
/** 优化/增补选中的平台，用于地图着色（后端 planType 仍为 basic，状态字段为 optimized/completed） */
const lastOptLinks = ref<Array<Record<string, unknown>>>([])
const lastSupLinks = ref<Array<Record<string, unknown>>>([])
const lastOptMeta = ref<Record<string, unknown> | null>(null)
const lastSupMeta = ref<Record<string, unknown> | null>(null)
const comparePlanLeft = ref('')
const comparePlanRight = ref('')
const compareResult = ref<unknown>(null)

function businessResultText(value: unknown, limit = 2500) {
  const clean = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(clean)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !key.toLowerCase().includes('wkt'))
        .map(([key, item]) => [key, clean(item)]),
    )
  }
  return JSON.stringify(clean(value), null, 2).slice(0, limit)
}

const instanceId = ref('')
const scaleId = ref('')
const taskCode = ref('')
const taskName = ref('暴雨观测任务')
const observationTarget = ref('面向目标区域开展连续观测并形成可追溯规划方案')
const priority = ref('normal')
const taskTimeStart = ref(isoNow(-30 * 60_000).slice(0, 16))
const taskTimeEnd = ref(isoNow(5 * 3600_000).slice(0, 16))
const researchAreaGeoJson = ref<SimpleGeometry | null>(null)
const researchAreaStatus = computed(() => {
  if (!researchAreaGeoJson.value) return '尚未设置任务区域'
  return researchAreaGeoJson.value.type === 'MultiPolygon' ? '已设置多个任务区域' : '已设置任务区域'
})

function applyMapDrawGeometry() {
  const g = mapDrawGeometry.value
  if (!g || !g.geojson) {
    error.value = '请先用地图工具绘面，双击结束'
    return
  }
  if (g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const d = 0.08
    researchAreaGeoJson.value = {
      type: 'Polygon',
      coordinates: [[
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ]],
    }
  } else {
    researchAreaGeoJson.value = g.geojson
  }
  message.value = '已采用地图绘制范围作为任务区域'
  error.value = null
}


const resolution = ref(10)
const temporalRes = ref('小时/次')
const targetAccuracy = ref(90)
const minCoverageRatio = ref(0.9)
const wTheme = ref(0.2)
const wSpace = ref(0.2)
const wTime = ref(0.2)
const wCapability = ref(0.2)
const wReliability = ref(0.2)

const taskId = ref<number | null>(null)
const taskStatus = ref('')
const currentStep = ref<StepKey>('create')
const doneSteps = ref<Set<StepKey>>(new Set())
const pending = ref(false)
const error = ref<string | null>(null)
const message = ref<string | null>(null)

const stepIndex = computed(() => STEP_ORDER.indexOf(currentStep.value))
const reverseSummary = computed(() => {
  const raw = reverseResult.value as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return null
  const inventory = (raw.inventory || {}) as Record<string, unknown>
  const estimates = Array.isArray(raw.typeEstimates) ? (raw.typeEstimates as Record<string, unknown>[]) : []
  const recs = Array.isArray(raw.recommendations) ? (raw.recommendations as unknown[]).map(String) : []
  return {
    feasibility: String(raw.feasibility || '-'),
    matched: inventory.matchedCount ?? '-',
    evaluated: inventory.totalEvaluated ?? '-',
    recommendedTotal: raw.recommendedTotalPlatforms ?? '-',
    estimates,
    recs,
  }
})

const hasTask = computed(() => taskId.value != null)
const canEditDraft = computed(
  () => taskId.value != null && (taskStatus.value === '' || taskStatus.value === 'draft' || taskStatus.value === 'created'),
)

function inferStepFromStatus(status: string): StepKey {
  const s = (status || '').toLowerCase()
  if (s === '' || s === 'draft' || s === 'created') return 'submit'
  // 已提交：默认从需求反算开始（文档顺序：反算→候选→关联）
  if (s === 'submitted' || s === 'ready' || s === 'active') return 'reverse'
  if (s.includes('basic') || s === 'associated') return 'optimize'
  if (s.includes('optim')) return 'supplement'
  if (s.includes('supple')) return 'evaluate'
  if (s.includes('evaluat') || s.includes('covered')) return 'output'
  if (s.includes('output') || s.includes('done') || s.includes('complete') || s.includes('finished')) return 'output'
  if (s === 'cancelled' || s === 'canceled') return 'create'
  return 'reverse'
}

async function setTab(key: string) {
  tab.value = key
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(route.query)) {
    if (v == null) continue
    q[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v)
  }
  q.tab = key
  // keep current task id in URL for refresh / map jump
  if (taskId.value != null) q.taskId = String(taskId.value)
  await router.replace({ path: '/planning', query: q })
}
function syncTab() {
  const t = route.query.tab
  if (typeof t === 'string' && tabs.some((x) => x.key === t)) tab.value = t
}

function canRun(step: StepKey) {
  if (pending.value) return false
  if (user.value == null) return false
  if (step === 'create') return currentStep.value === 'create' && taskId.value == null
  if (taskId.value == null) return false
  // 已提交任务不可再次“提交”
  if (step === 'submit') {
    const st = String(taskStatus.value || '').toLowerCase()
    if (st && st !== 'draft' && st !== 'created') return false
  }
  // 当前步可执行；已完成步骤可重跑；不可跳过未完成步骤
  if (currentStep.value === step) return true
  if (doneSteps.value.has(step)) return true
  return false
}

function stepBlockedReason(step: StepKey): string {
  if (pending.value) return '请等待当前操作完成'
  if (user.value == null) return '请先登录'
  if (step === 'create') {
    // 已选任务时创建步视为完成，不显示误导性锁定文案
    if (taskId.value != null || doneSteps.value.has('create')) return ''
    if (currentStep.value !== 'create') return '当前不在创建步骤'
    return ''
  }
  if (taskId.value == null) return '请先创建并选中任务'
  if (step === 'submit') {
    const st = String(taskStatus.value || '').toLowerCase()
    if (st && st !== 'draft' && st !== 'created') return '任务已提交，无需重复提交'
  }
  if (currentStep.value === step || doneSteps.value.has(step)) return ''
  const curIdx = STEP_ORDER.indexOf(currentStep.value)
  const stepIdx = STEP_ORDER.indexOf(step)
  if (stepIdx > curIdx) {
    const prev = STEP_ORDER[stepIdx - 1]
    const prevTitle = STEPS.find((s) => s.key === prev)?.title || String(prev)
    return '请先完成：' + prevTitle
  }
  // 已越过的步骤允许回看，不显示“不可执行”
  if (stepIdx < curIdx) return ''
  return '该步骤当前不可执行'
}

function onStepClick(step: StepKey) {
  if (step === currentStep.value) return
  if (doneSteps.value.has(step) || step === 'create' && taskId.value == null) {
    currentStep.value = step
    message.value = '已切换到步骤：' + (STEPS.find((s) => s.key === step)?.title || step)
    error.value = null
    return
  }
  // 允许查看当前之前已完成链路中的任一步
  const curIdx = STEP_ORDER.indexOf(currentStep.value)
  const stepIdx = STEP_ORDER.indexOf(step)
  if (stepIdx < curIdx) {
    currentStep.value = step
    message.value = '已回看步骤：' + (STEPS.find((s) => s.key === step)?.title || step) + '（可重跑该步）'
    error.value = null
    return
  }
  error.value = stepBlockedReason(step) || '步骤未解锁'
}

const currentAction = computed(() => {
  const key = currentStep.value
  const map: Record<StepKey, { action: StepKey; label: string; redoLabel: string }> = {
    create: { action: 'create', label: '执行创建任务', redoLabel: '重新创建任务' },
    submit: { action: 'submit', label: '执行提交任务', redoLabel: '重新提交任务' },
    reverse: { action: 'reverse', label: '执行需求反算', redoLabel: '重新执行需求反算' },
    candidates: { action: 'candidates', label: '执行候选评分', redoLabel: '重新执行候选评分' },
    basic: { action: 'basic', label: '执行基础关联', redoLabel: '重新执行基础关联' },
    optimize: { action: 'optimize', label: '执行优化关联', redoLabel: '重新执行优化关联' },
    supplement: { action: 'supplement', label: '执行增补关联', redoLabel: '重新执行增补关联' },
    evaluate: { action: 'evaluate', label: '执行满足度评估', redoLabel: '重新执行满足度评估' },
    output: { action: 'output', label: '执行规划输出', redoLabel: '重新生成规划输出' },
  }
  const item = map[key]
  if (!item) return item
  // 当前步已完成且仍停留在该步时，按钮文案改为“重新…”，避免看起来像没做完
  if (doneSteps.value.has(key) && key !== 'create') {
    return { action: item.action, label: item.redoLabel }
  }
  return { action: item.action, label: item.label }
})

async function runCurrentStep() {
  const a = currentAction.value?.action
  if (!a) return
  // 主操作在「需求与关联」表单区；若人在列表页，先切过去避免盲点
  if (tab.value !== 'flow' && a !== 'candidates') {
    await setTab('flow')
  }
  if (a === 'create') return createTask()
  if (a === 'submit') return submitTask()
  if (a === 'reverse') return requirementReverse()
  if (a === 'candidates') return confirmCandidates()
  if (a === 'basic') return basicAssociation()
  if (a === 'optimize') return optimizeAssociation()
  if (a === 'supplement') return supplementAssociation()
  if (a === 'evaluate') return requirementEvaluation()
  if (a === 'output') return planningOutput()
}


function applyStepProgress(next: StepKey, options: { rewindAfter?: boolean } = {}) {
  const idx = STEP_ORDER.indexOf(next)
  const done = new Set<StepKey>(doneSteps.value)
  // 保证前序步骤标记完成
  for (let i = 0; i < idx; i += 1) {
    const s = STEP_ORDER[i]
    if (s) done.add(s)
  }
  if (options.rewindAfter) {
    // 重跑前序关键步骤时，清理后续“已完成”标记，避免逻辑假完成
    for (let i = idx + 1; i < STEP_ORDER.length; i += 1) {
      const s = STEP_ORDER[i]
      if (s) done.delete(s)
    }
  }
  doneSteps.value = done
  currentStep.value = next
}

function markDone(step: StepKey) {
  const next = new Set(doneSteps.value)
  next.add(step)
  doneSteps.value = next
}

function advanceTo(step: StepKey) {
  currentStep.value = step
}

const selectedInstanceWindow = computed(() => {
  const row = instances.value.find((i) => String(i.id) === instanceId.value)
  if (!row) return ''
  const a = row.timeStart ? String(row.timeStart) : ''
  const b = row.timeEnd ? String(row.timeEnd) : ''
  if (!a && !b) return '未设置'
  return (a || '-') + ' ~ ' + (b || '-')
})

function syncFromSelectedInstance() {
  const row = instances.value.find((i) => String(i.id) === instanceId.value)
  if (!row) return
  if (row.scaleId) scaleId.value = String(row.scaleId)
  if (row.resolution != null) resolution.value = Number(row.resolution)
  if (row.temporalRes) temporalRes.value = String(row.temporalRes)
  if (row.targetAccuracy != null) targetAccuracy.value = Number(row.targetAccuracy)
  if (!hasTask.value && row.timeStart) taskTimeStart.value = String(row.timeStart).slice(0, 16)
  if (!hasTask.value && row.timeEnd) taskTimeEnd.value = String(row.timeEnd).slice(0, 16)
}


function preferDemoInstance() {
  if (instanceId.value) return
  const list = instances.value
  const demo = list.find((i) => {
    const name = String(i.instanceName || i.name || '')
    const code = String(i.code || '')
    return name.includes('演示') || code.toUpperCase().includes('DEMO')
  })
  const published = list.find((i) => String(i.status || '') === 'published' && String(i.spatialWkt || '').trim())
  const pick = demo || published || list[0]
  if (pick) {
    instanceId.value = pickId(pick)
    syncFromSelectedInstance()
  }
}

async function loadLists() {
  const [inst, sc, t, p] = await Promise.all([
    api.listInstances(),
    api.listScales(),
    api.listTasks(),
    api.listPlans(),
  ])
  instances.value = inst.data
  scales.value = sc.data
  tasks.value = t.data
  {
    const raw = p.data as unknown
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).results)
        ? ((raw as Record<string, unknown>).results as Record<string, unknown>[])
        : []
    plans.value = sortPlans(list as Record<string, unknown>[])
  }
  preferDemoInstance()
  if (scaleId.value === '' && scales.value[0]) scaleId.value = pickId(scales.value[0])
  syncFromSelectedInstance()
}

async function createTask() {
  if (canRun('create') === false) return
  if (taskName.value.trim() === '' || observationTarget.value.trim() === '') {
    error.value = '请填写任务名称和观测目标'
    return
  }
  const start = new Date(taskTimeStart.value)
  const end = new Date(taskTimeEnd.value)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    error.value = '任务结束时间必须晚于开始时间'
    return
  }
  pending.value = true
  error.value = null
  message.value = null
  try { await showPlanningWorkspace('/planning') } catch { /* map refresh optional */ }
  try {
    const created = await api.createTask({
      name: taskName.value,
      observationTarget: observationTarget.value,
      priority: priority.value,
      description: '观测规划业务任务',
      taskType: 'manual',
      timeStart: start.toISOString(),
      timeEnd: end.toISOString(),
    })
    const data = created.data as { id: number; code?: string; status?: string }
    taskId.value = data.id
    taskCode.value = data.code || ''
    taskStatus.value = data.status || 'draft'
    setLastTaskId(data.id)
    markDone('create')
    advanceTo('submit')
    message.value = '任务草稿已保存，请绘制任务区域并完成观测配置'
    await setTab('flow')
    try { await showPlanningWorkspace('/planning') } catch { /* map refresh optional */ }
    try {
      await selectShellFeature('task', String(data.id), { openBubble: true, fly: true })
    } catch { /* map optional */ }
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '创建任务失败')
  } finally {
    pending.value = false
  }
}

async function saveTaskConfiguration() {
  if (!canEditDraft.value || taskId.value == null) return false
  if (!instanceId.value || !scaleId.value) {
    error.value = '请选择指标实例和观测尺度'
    return false
  }
  if (!researchAreaGeoJson.value) {
    error.value = '请先在地图绘制任务区域，再采用绘制结果'
    return false
  }
  pending.value = true
  error.value = null
  try {
    const res = await api.updateTask(taskId.value, {
      name: taskName.value,
      observationTarget: observationTarget.value,
      priority: priority.value,
      scaleId: Number(scaleId.value),
      indicatorInstanceIds: [Number(instanceId.value)],
      researchAreaGeoJson: researchAreaGeoJson.value,
      resolution: Number(resolution.value),
      temporalRes: temporalRes.value,
      targetAccuracy: Number(targetAccuracy.value),
      minCoverageRatio: Number(minCoverageRatio.value),
      maxOptimizeSats: 1,
      wTheme: Number(wTheme.value),
      wSpace: Number(wSpace.value),
      wTime: Number(wTime.value),
      wCapability: Number(wCapability.value),
      wReliability: Number(wReliability.value),
    })
    taskStatus.value = String((res.data as { status?: string }).status || 'draft')
    await drawPlanningCoverageOverlay({ taskGeoJson: researchAreaGeoJson.value, fit: true })
    message.value = '任务区域和观测约束已保存'
    await loadLists()
    return true
  } catch (err) {
    error.value = errMessage(err, '保存任务配置失败')
    return false
  } finally {
    pending.value = false
  }
}

async function submitTask() {
  if (canRun('submit') === false || taskId.value == null) return
  if (canEditDraft.value && !(await saveTaskConfiguration())) return
  pending.value = true
  error.value = null
  try {
    const res = await api.submitTask(taskId.value)
    taskStatus.value = String((res.data as { status?: string }).status || 'submitted')
    markDone('submit')
    advanceTo('reverse')
    message.value = '任务已提交，请先做需求反算'
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '提交失败')
  } finally {
    pending.value = false
  }
}


function applyWeightPreset(kind: string) {
  if (kind === 'balanced') {
    wTheme.value = 0.2; wSpace.value = 0.2; wTime.value = 0.2; wCapability.value = 0.2; wReliability.value = 0.2
  } else if (kind === 'space') {
    wTheme.value = 0.1; wSpace.value = 0.4; wTime.value = 0.15; wCapability.value = 0.2; wReliability.value = 0.15
  } else if (kind === 'reliability') {
    wTheme.value = 0.1; wSpace.value = 0.15; wTime.value = 0.15; wCapability.value = 0.2; wReliability.value = 0.4
  } else if (kind === 'capability') {
    wTheme.value = 0.1; wSpace.value = 0.15; wTime.value = 0.15; wCapability.value = 0.4; wReliability.value = 0.2
  }
  message.value = '已套用评分权重预设：' + kind + '（请点保存权重生效）'
}

async function saveWeights() {
  if (taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    await api.updateTask(taskId.value, {
      wTheme: wTheme.value,
      wSpace: wSpace.value,
      wTime: wTime.value,
      wCapability: wCapability.value,
      wReliability: wReliability.value,
    })
    message.value = '评分权重已保存（需五维之和为 1）'
  } catch (err) {
    error.value = errMessage(err, '保存权重失败')
  } finally {
    pending.value = false
  }
}

async function requirementReverse() {
  if (canRun('reverse') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.requirementReverse(taskId.value)
    reverseResult.value = res.data
    const hadAssociation = doneSteps.value.has('basic')
    markDone('reverse')
    applyStepProgress('candidates', { rewindAfter: hadAssociation })
    markDone('reverse')
    message.value = hadAssociation
      ? '需求反算已重跑：后续关联步骤需按序重做'
      : '需求反算完成，请查看候选与评分'
  } catch (err) {
    error.value = errMessage(err, '需求反算失败')
  } finally {
    pending.value = false
  }
}

async function confirmCandidates() {
  if (canRun('candidates') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const screened = await api.screenTaskCandidates(taskId.value)
    const data = screened.data as Record<string, unknown>
    candidateMeta.value = data
    candidateRows.value = Array.isArray(data.candidates) ? data.candidates as Record<string, unknown>[] : []
    excludedRows.value = Array.isArray(data.excluded) ? data.excluded as Record<string, unknown>[] : []
    markDone('candidates')
    if (STEP_ORDER.indexOf(currentStep.value) <= STEP_ORDER.indexOf('candidates')) {
      advanceTo('basic')
    }
    await setTab('flow')
    message.value = '候选筛选与评分已确认，可进行基础关联'
    try { await showCandidatesOnMap() } catch { /* map optional */ }
  } catch (err) {
    error.value = errMessage(err, '候选确认失败')
  } finally {
    pending.value = false
  }
}

async function basicAssociation() {
  if (canRun('basic') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    await api.basicAssociation(taskId.value)
    markDone('basic')
    advanceTo('optimize')
    await setTab('flow')
    message.value = '基础关联完成'
    await loadLists()
    // 关联后同步最新方案匹配，便于地图连线与方案管理
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const res = await api.getAssociationResult(String(planRow.id))
        planResult.value = res.data
      } catch { /* optional */ }
    }
    await showAssociationOnMap('basic')
    await loadCandidates(false)
  } catch (err) {
    error.value = errMessage(err, '基础关联失败')
  } finally {
    pending.value = false
  }
}

async function optimizeAssociation() {
  if (canRun('optimize') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.optimizeAssociation(taskId.value)
    lastOptMeta.value = asRec(res.data)
    lastOptLinks.value = buildLinksFromOptPayload(res.data, 'optimized')
    markDone('optimize')
    advanceTo('supplement')
    await setTab('flow')
    message.value =
      '优化关联完成：入选资源 ' +
      lastOptLinks.value.length +
      ' 个' +
      (lastOptLinks.value.length ? '，正在上图…' : '')
    await loadLists()
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const ar = await api.getAssociationResult(String(planRow.id))
        planResult.value = ar.data
      } catch { /* optional */ }
    }
    await showAssociationOnMap('optimized')
    await loadCandidates(false)
  } catch (err) {
    error.value = errMessage(err, '优化关联失败')
  } finally {
    pending.value = false
  }
}

async function supplementAssociation() {
  if (canRun('supplement') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.supplementAssociation(taskId.value)
    lastSupMeta.value = asRec(res.data)
    // 增补：优先 after.resourceIds（优化入选+增补），否则 added+opt
    const built = buildLinksFromOptPayload(res.data, 'supplement')
    if (!built.length && lastOptLinks.value.length) {
      // fallback merge opt + added ids from payload
      const root = asRec(res.data)
      const results = Array.isArray(root.results) ? (root.results as Record<string, unknown>[]) : []
      const added = new Set<string>()
      for (const item of results) {
        for (const id of (item.addedResourceIds || []) as unknown[]) added.add(String(id))
        for (const id of (asRec(item.after).resourceIds || []) as unknown[]) added.add(String(id))
      }
      const base: Array<Record<string, unknown>> = lastOptLinks.value.map((x) => ({ ...x, mode: 'supplement' }))
      for (const id of added) {
        if (base.some((b) => String(b.platformId) === id)) continue
        base.push({
          platformId: Number(id) || id,
          id: Number(id) || id,
          score: 0,
          matched: true,
          mode: 'supplement',
          platformName: '平台#' + id,
          name: '平台#' + id,
          reason: '增补入选',
        })
      }
      lastSupLinks.value = base
    } else {
      lastSupLinks.value = built
    }
    markDone('supplement')
    advanceTo('evaluate')
    await setTab('flow')
    message.value =
      '增补关联完成：资源 ' +
      lastSupLinks.value.length +
      ' 个' +
      (lastSupLinks.value.length ? '，正在上图…' : '')
    await loadLists()
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const ar = await api.getAssociationResult(String(planRow.id))
        planResult.value = ar.data
      } catch { /* optional */ }
    }
    await showAssociationOnMap('supplement')
  } catch (err) {
    error.value = errMessage(err, '增补关联失败')
  } finally {
    pending.value = false
  }
}

async function requirementEvaluation() {
  if (canRun('evaluate') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.requirementEvaluation(taskId.value)
    evalResult.value = res.data
    const oc = (res.data as { overallCoverage?: Record<string, unknown> })?.overallCoverage || {}
    try {
      await drawPlanningCoverageOverlay({
        taskGeoJson: researchAreaGeoJson.value,
        coverageWkt: String(oc.coverageWkt || ''),
        gapWkt: String(oc.gapWkt || ''),
        fit: true,
      })
    } catch { /* map optional */ }
    markDone('evaluate')
    advanceTo('output')
    await setTab('flow')
    message.value = '满足度评估完成（关联后核查）'
  } catch (err) {
    error.value = errMessage(err, '评估失败')
  } finally {
    pending.value = false
  }
}

async function planningOutput() {
  if (canRun('output') === false || taskId.value == null) return
  pending.value = true
  error.value = null
  try {
    const res = await api.planningOutput(taskId.value)
    outputResult.value = res.data
    const data = res.data as {
      task?: { researchAreaGeoJson?: SimpleGeometry | null; researchAreaWkt?: string }
      summary?: { overall?: { coverageWkt?: string; gapWkt?: string } }
    }
    try {
      await drawPlanningCoverageOverlay({
        taskGeoJson: data.task?.researchAreaGeoJson || researchAreaGeoJson.value,
        taskWkt: data.task?.researchAreaGeoJson ? '' : String(data.task?.researchAreaWkt || ''),
        coverageWkt: String(data.summary?.overall?.coverageWkt || ''),
        gapWkt: String(data.summary?.overall?.gapWkt || ''),
        fit: true,
      })
    } catch { /* map optional */ }
    markDone('output')
    message.value = '规划输出已生成'
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '规划输出失败')
  } finally {
    pending.value = false
  }
}

async function loadCandidates(switchTab = true, drawMap = true) {
  if (taskId.value == null) {
    error.value = '请先创建或选择任务'
    return
  }
  try {
    const res = await api.resourceCandidates(taskId.value)
    const data = res.data as Record<string, unknown>
    candidateMeta.value = data
    const list = Array.isArray(data.candidates) ? (data.candidates as Record<string, unknown>[]) : []
    const excluded = Array.isArray(data.excluded) ? (data.excluded as Record<string, unknown>[]) : []
    candidateRows.value = list
    // 规划关联线
    if (drawMap && taskId.value != null && list.length) {
      void drawAssociationLinks(
        taskId.value,
        list.map((c) => ({
          platformId: (c.platformId ?? c.id) as string | number,
          score: Number(c.score ?? 0),
          mode: 'candidate' as const,
          name: String(c.platformName || c.name || ''),
        })),
        { fit: true, ensureLayers: true },
      )
    }
    excludedRows.value = excluded
    if (switchTab) {
      await setTab('candidates')
    }
    message.value = '候选资源 ' + list.length + ' 条'
  } catch (err) {
    error.value = errMessage(err, '候选加载失败')
  }
}

function inferStepFromPlans(taskPlans: Record<string, unknown>[], status: string): StepKey {
  if (!taskPlans.length) {
    return inferStepFromStatus(status)
  }
  // 同时看方案状态与 planType（basic/optimized/supplement），避免 published 方案被误判回需求反算
  const tags = taskPlans.map((p) => {
    const st = String(p.status || '').toLowerCase()
    const pt = String(p.planType || p.associationMode || p.mode || p.type || '').toLowerCase()
    return `${st} ${pt}`
  })
  const has = (keys: string[]) => tags.some((t) => keys.some((k) => t.includes(k)))
  if (has(['archived', 'published', 'approved', 'complete', 'completed', 'output', 'final'])) {
    // 已有正式方案：进入评估/输出阶段
    if (has(['supplement', '增补'])) return 'evaluate'
    if (has(['optim', '优化'])) return 'supplement'
    if (has(['basic', 'base', '基础'])) return 'optimize'
    return 'evaluate'
  }
  if (has(['supplement', '增补'])) return 'evaluate'
  if (has(['optim', '优化'])) return 'supplement'
  if (has(['basic', 'base', '基础', 'draft', 'created', 'basic_completed'])) return 'optimize'
  return inferStepFromStatus(status)
}

async function selectTask(id: unknown) {
  void locateTaskOnMap(String(id as string | number), { silent: true })

  const tid = Number(id)
  if (Number.isFinite(tid) === false) return
  taskId.value = tid
  setLastTaskId(tid)
  // 选择并继续：进入需求与关联工作台
  await setTab('flow')
  reverseResult.value = null
  evalResult.value = null
  outputResult.value = null
  candidateRows.value = []
  excludedRows.value = []
  candidateMeta.value = null
  try {
    const res = await api.getTask(tid)
    const data = res.data as {
      status?: string
      scaleId?: number
      indicatorInstanceIds?: number[]
      name?: string
      code?: string
      observationTarget?: string
      priority?: string
      timeStart?: string
      timeEnd?: string
      researchAreaGeoJson?: SimpleGeometry | null
      researchAreaWkt?: string
      resolution?: number
      temporalRes?: string
      targetAccuracy?: number
      minCoverageRatio?: number
      wTheme?: number
      wSpace?: number
      wTime?: number
      wCapability?: number
      wReliability?: number
    }
    taskStatus.value = data.status || ''
    if (data.scaleId) scaleId.value = String(data.scaleId)
    if (data.indicatorInstanceIds && data.indicatorInstanceIds[0]) instanceId.value = String(data.indicatorInstanceIds[0])
    if (data.name) taskName.value = String(data.name)
    if (data.code) taskCode.value = String(data.code)
    observationTarget.value = String(data.observationTarget || '')
    priority.value = String(data.priority || 'normal')
    if (data.timeStart) taskTimeStart.value = String(data.timeStart).slice(0, 16)
    if (data.timeEnd) taskTimeEnd.value = String(data.timeEnd).slice(0, 16)
    researchAreaGeoJson.value = data.researchAreaGeoJson || wktToGeoJson(data.researchAreaWkt)
    if (data.resolution != null) resolution.value = Number(data.resolution)
    if (data.temporalRes) temporalRes.value = String(data.temporalRes)
    if (data.targetAccuracy != null) targetAccuracy.value = Number(data.targetAccuracy)
    if (data.minCoverageRatio != null) minCoverageRatio.value = Number(data.minCoverageRatio)
    if (data.wTheme != null) wTheme.value = Number(data.wTheme)
    if (data.wSpace != null) wSpace.value = Number(data.wSpace)
    if (data.wTime != null) wTime.value = Number(data.wTime)
    if (data.wCapability != null) wCapability.value = Number(data.wCapability)
    if (data.wReliability != null) wReliability.value = Number(data.wReliability)

    // 结合任务状态 + 方案状态推断进度，避免已关联任务被错误拉回“需求反算”
    const taskPlans = plans.value.filter((p) => Number(p.taskId) === tid)
    const inferred = inferStepFromPlans(taskPlans, taskStatus.value)
    const idx = STEP_ORDER.indexOf(inferred)
    const done = new Set<StepKey>(['create'])
    for (let i = 0; i < idx; i += 1) {
      const step = STEP_ORDER[i]
      if (step) done.add(step)
    }
    // 若已有方案，严格按 planType 标记完成，避免“任意 published”误标优化/增补已完成
    if (taskPlans.length) {
      done.add('submit')
      done.add('reverse')
      done.add('candidates')
      done.add('basic')
      const typeTags = taskPlans
        .map((p) => String(p.planType || p.associationMode || p.mode || p.type || '').toLowerCase())
        .join(' ')
      if (typeTags.includes('optim') || typeTags.includes('优化')) {
        done.add('optimize')
      }
      if (typeTags.includes('supplement') || typeTags.includes('增补')) {
        done.add('supplement')
      }
      // 仅当已到增补之后，或方案已发布/审核且至少完成基础关联，才视评估可回看
      const statusTags = taskPlans.map((p) => String(p.status || '').toLowerCase()).join(' ')
      if (
        done.has('supplement')
        || ((statusTags.includes('published') || statusTags.includes('approved') || statusTags.includes('archived'))
          && done.has('optimize'))
      ) {
        done.add('evaluate')
      }
    }
    doneSteps.value = done
    advanceTo(inferred)
    const summary =
      '已选择任务 #' +
      tid +
      ' · 状态 ' +
      (taskStatus.value || '-') +
      ' · 方案 ' +
      taskPlans.length +
      ' · 下一步 ' +
      inferred
    message.value = summary
    // 选中后进入「需求与关联」，并同步左侧二级菜单与 URL
    await setTab('flow')
    // 选中任务后自动上图：有方案则画关联线，否则尝试候选资源（最终文案在地图同步后写回）
    // 地图同步异步进行，避免阻塞任务选择反馈
    void (async () => {
      try {
        let hasMatches = taskPlans.some((p) => Array.isArray(p.resourceMatches) && p.resourceMatches.length)
        if (!hasMatches && taskPlans[0]?.id != null) {
          try {
            const res = await api.getAssociationResult(String(taskPlans[0].id))
            planResult.value = res.data as Record<string, unknown>
            const data = res.data as Record<string, unknown>
            const planObj = (data.plan || data) as Record<string, unknown>
            const rm = planObj.resourceMatches || data.resourceMatches
            hasMatches = Array.isArray(rm) && rm.length > 0
          } catch {
            /* optional */
          }
        } else if (taskPlans[0]) {
          planResult.value = taskPlans[0] as Record<string, unknown>
        }
        if (hasMatches) {
          await showAssociationOnMap('basic')
          if (taskId.value === tid) message.value = summary + ' · 已同步基础关联上图'
        } else {
          await loadCandidates(false, false)
          if (taskId.value === tid) {
            if (candidateRows.value.length) {
              await showCandidatesOnMap()
              message.value = summary + ' · 候选 ' + candidateRows.value.length + ' 已上图'
            } else {
              message.value = summary
            }
          }
        }
      } catch {
        if (taskId.value === tid) message.value = summary
      }
    })()
  } catch (err) {
    error.value = errMessage(err, '加载任务失败')
  }
}

async function removeTask(id: unknown) {
  if (window.confirm('确认删除该观测任务？仅草稿/可删状态会成功。') === false) return
  pending.value = true
  error.value = null
  try {
    await api.deleteTask(String(id))
    if (taskId.value != null && String(taskId.value) === String(id)) await resetForm()
    message.value = '任务已删除'
    try { await showPlanningWorkspace('/planning') } catch { /* map refresh optional */ }
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '删除任务失败')
  } finally {
    pending.value = false
  }
}

async function openOnMap() {
  if (taskId.value == null) return
  await showPlanningWorkspace('/planning')
  const ok = await selectShellFeature('task', String(taskId.value), { openBubble: true, fly: true })
  message.value = ok
    ? `已在底图定位任务 #${taskId.value}`
    : `任务图层已刷新；未找到任务 #${taskId.value} 的空间范围`
}


async function resetForm() {
  taskId.value = null
  taskStatus.value = ''
  currentStep.value = 'create'
  doneSteps.value = new Set()
  message.value = null
  error.value = null
  reverseResult.value = null
  evalResult.value = null
  outputResult.value = null
  candidateRows.value = []
  excludedRows.value = []
  candidateMeta.value = null
  planResult.value = null
  taskCode.value = ''
  researchAreaGeoJson.value = null
  // clear taskId from URL so map jump / watch does not re-select
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(route.query)) {
    if (v == null || k === 'taskId') continue
    q[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v)
  }
  q.tab = 'flow'
  tab.value = 'flow'
  await router.replace({ path: '/planning', query: q })
}

async function loadPlanResult(planId: unknown, opts?: { silent?: boolean }) {
  try {
    const res = await api.getAssociationResult(String(planId))
    planResult.value = res.data
    const plan = plans.value.find((x) => String(x.id) === String(planId))
    const tid = Number(plan?.taskId ?? plan?.task_id ?? taskId.value)
    if (Number.isFinite(tid)) {
      taskId.value = tid
      setLastTaskId(tid)
    }
    try {
      await showPlanningWorkspace('/planning')
    } catch {
      /* map optional */
    }
    const planObj = (planResult.value as Record<string, unknown> | null) || {}
    const nested = (planObj.plan as Record<string, unknown> | undefined) || {}
    const rawType = String(
      planObj.planType || nested.planType || plan?.planType || plan?.status || '',
    ).toLowerCase()
    const mode: 'basic' | 'optimized' | 'supplement' =
      rawType.includes('optim') || rawType.includes('优化')
        ? 'optimized'
        : rawType.includes('supple') || rawType.includes('增补')
          ? 'supplement'
          : 'basic'
    try {
      await showAssociationOnMap(mode, { silent: !!opts?.silent })
      if (taskId.value != null) {
        await selectShellFeature('task', String(taskId.value), { openBubble: true, fly: true })
      }
    } catch {
      /* map optional */
    }
    const modeLabel = mode === 'basic' ? '基础' : mode === 'optimized' ? '优化' : '增补'
    if (!opts?.silent) {
      message.value = '已加载方案 #' + planId + ' 并同步' + modeLabel + '关联上图'
    }
  } catch (err) {
    error.value = errMessage(err, '方案结果加载失败')
  }
}

async function onPlanRowClick(p: Record<string, unknown>) {
  const tid = Number(p.taskId ?? p.task_id)
  if (Number.isFinite(tid)) {
    taskId.value = tid
    setLastTaskId(tid)
    await locateTaskOnMap(String(tid))
  }
  await loadPlanResult(p.id)
}


function planById(planId: unknown) {
  return plans.value.find((p) => String(p.id) === String(planId)) || null
}
function planLiveStatus(planId: unknown, fallback?: unknown) {
  const row = planById(planId)
  return row?.status ?? fallback
}
function canApprovePlanStatus(status: unknown) {
  return !canByStatus(status, ['published', 'archived', 'approved'])
}
function canPublishPlanStatus(status: unknown) {
  return canByStatus(status, ['approved']) && !canByStatus(status, ['published', 'archived'])
}

async function doPublishPlan(planId: unknown, status?: unknown) {
  status = planLiveStatus(planId, status)
  if (canByStatus(status, ['published'])) {
    error.value = '方案已发布，无需重复操作'
    return
  }
  if (canByStatus(status, ['archived'])) {
    error.value = '已归档方案不能发布'
    return
  }
  if (canByStatus(status, ['approved']) === false) {
    error.value = '请先审核通过后再发布（当前：' + planStatusLabel(status) + '）'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.publishPlan(String(planId))
    await loadLists()
    try { await loadPlanResult(planId, { silent: true }) } catch { /* map optional */ }
    message.value = '方案 #' + planId + ' 已发布，已同步地图关联'
  } catch (err) {
    error.value = errMessage(err, '方案发布失败')
  } finally {
    pending.value = false
  }
}

async function doArchivePlan(planId: unknown, status?: unknown) {
  status = planLiveStatus(planId, status)
  if (canByStatus(status, ['archived'])) {
    error.value = '方案已归档'
    return
  }
  if (window.confirm('确认归档该方案？归档后不可再发布。') === false) return
  pending.value = true
  error.value = null
  try {
    await api.archivePlan(String(planId))
    message.value = '方案 #' + planId + ' 已归档'
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '方案归档失败')
  } finally {
    pending.value = false
  }
}


async function doCopyPlan(planId: unknown) {
  pending.value = true
  error.value = null
  try {
    const res = await api.copyPlan(String(planId))
    const data = res.data as { id?: number; status?: string }
    const newId = data.id
    lastCopiedPlanId.value = newId ?? null
    message.value =
      '方案已复制为草稿 #' +
      String(newId ?? '') +
      '（已排到列表前部；请先点「审核」再「发布」）'
    await loadLists()
    if (newId != null) {
      try {
        await loadPlanResult(newId, { silent: true })
      } catch {
        /* map optional */
      }
    }
    message.value =
      '方案已复制为草稿 #' +
      String(newId ?? '') +
      '（已排到列表前部；请先点「审核」再「发布」）'
  } catch (err) {
    error.value = errMessage(err, '复制方案失败')
  } finally {
    pending.value = false
  }
}



async function doApprovePlan(planId: unknown, status?: unknown) {
  status = planLiveStatus(planId, status)
  if (canByStatus(status, ['published', 'archived', 'approved'])) {
    error.value = '该方案不可审核（已审核/已发布/已归档）'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.approvePlan(String(planId))
    await loadLists()
    try { await loadPlanResult(planId, { silent: true }) } catch { /* map optional */ }
    message.value = '方案 #' + planId + ' 已审核通过，可继续发布；已同步地图关联'
  } catch (err) {
    error.value = errMessage(err, '审核失败')
  } finally {
    pending.value = false
  }
}


function asCompareObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function planCompareSide(side: 'left' | 'right') {
  return asCompareObj(asCompareObj(compareResult.value)[side])
}
function planCompareList(key: 'onlyLeft' | 'onlyRight' | 'scoreDiff') {
  const raw = asCompareObj(compareResult.value)[key]
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
}
function scoreDeltaClass(delta: unknown) {
  const n = Number(delta)
  if (!Number.isFinite(n) || n === 0) return 'diff-same'
  return n > 0 ? 'diff-up' : 'diff-down'
}

async function runPlanCompare() {
  if (comparePlanLeft.value === '' || comparePlanRight.value === '') {
    error.value = '请选择左右两份方案进行对比'
    return
  }
  if (comparePlanLeft.value === comparePlanRight.value) {
    error.value = '对比方案不能相同'
    return
  }
  pending.value = true
  error.value = null
  try {
    const res = await api.comparePlans(comparePlanLeft.value, comparePlanRight.value)
    compareResult.value = res.data
    message.value = '方案对比完成'
  } catch (err) {
    error.value = errMessage(err, '方案对比失败')
  } finally {
    pending.value = false
  }
}


async function bindSelectedIndicator() {
  if (taskId.value == null) {
    error.value = '请先创建或选择任务'
    return
  }
  if (canByStatus(taskStatus.value, ['draft', '']) === false && taskStatus.value !== '') {
    error.value = '只有草稿任务可以追加指标（当前：' + taskStatus.value + '）'
    return
  }
  if (instanceId.value === '') {
    error.value = '请选择指标实例'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.addTaskIndicators(taskId.value, [Number(instanceId.value)])
    message.value = '已为任务追加指标实例 #' + instanceId.value
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '追加指标失败')
  } finally {
    pending.value = false
  }
}

function pickScores(c: Record<string, unknown>): Record<string, unknown> | null {
  const direct = (c.scores || c.scoreDetail) as Record<string, unknown> | undefined
  if (direct && typeof direct === 'object') return direct
  const sensors = c.sensors as Record<string, unknown>[] | undefined
  if (Array.isArray(sensors) && sensors[0]) {
    const s = sensors[0].scores as Record<string, unknown> | undefined
    if (s && typeof s === 'object') return s
  }
  return null
}

const DIM_LABELS: Record<string, string> = {
  theme: '主题',
  space: '空间',
  time: '时间',
  capability: '能力',
  reliability: '可靠',
  total: '综合',
}

function scoreOf(c: Record<string, unknown>) {
  const scores = pickScores(c)
  const v =
    c.score ??
    c.totalScore ??
    c.weightedScore ??
    c.finalScore ??
    (scores && scores.total)
  return v == null ? '-' : v
}

function explainOf(c: Record<string, unknown>) {
  const scores = pickScores(c)
  const reasons = c.reasons || c.reason || c.explanation
  const parts: string[] = []
  if (scores && typeof scores === 'object') {
    const exp = scores.explanations as Record<string, unknown> | undefined
    const weights = scores.weights as Record<string, unknown> | undefined
    if (exp && typeof exp === 'object') {
      parts.push(
        Object.entries(exp)
          .map(([k, v]) => {
            const label = DIM_LABELS[k] || k
            const w = weights && weights[k] != null ? ' 权重' + String(weights[k]) : ''
            const sc = scores[k] != null ? ' 分值' + String(scores[k]) : ''
            return label + sc + w + '：' + String(v)
          })
          .join('；'),
      )
    }
  }
  if (Array.isArray(reasons) && reasons.length) {
    parts.push(reasons.map(String).join('；'))
  } else if (typeof reasons === 'string' && reasons) {
    parts.push(reasons)
  }
  if (parts.length) return parts.join(' | ')
  return '-'
}

function dimScore(c: Record<string, unknown>, key: string) {
  const direct = pickScores(c)
  if (direct && direct[key] != null) return direct[key]
  return '-'
}

function planStatusLabel(status: unknown) {
  const s = String(status || '').toLowerCase()
  const map: Record<string, string> = {
    draft: '草稿',
    completed: '已完成',
    approved: '已审核',
    published: '已发布',
    archived: '已归档',
    supplement_incomplete: '增补未完成',
    basic: '基础方案',
    optimized: '优化方案',
  }
  return map[s] || String(status || '-')
}

function isPlanRowSelected(p: Record<string, unknown>) {
  if (taskId.value != null && String(p.taskId ?? p.task_id ?? '') === String(taskId.value)) return true
  const pr = planResult.value as Record<string, unknown> | null
  if (!pr) return false
  const planObj = (pr.plan || pr) as Record<string, unknown>
  const pid = planObj.id ?? planObj.planId ?? pr.id ?? pr.planId
  return pid != null && String(pid) === String(p.id)
}



async function ensureListsLoaded() {
  if (!user.value) return
  try {
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '列表加载失败')
  }
}

onMounted(async () => {
  syncTab()
  await ensureListsLoaded()
  await applyRouteTaskQuery()
  applyRouteCoordHint()
  // 无路由指定任务时，优先载入演示故事线任务，便于直接走规划
  if (tab.value === 'flow' && taskId.value == null && user.value && tasks.value.length) {
    const demo =
      tasks.value.find((t) => String(t.code || '').toUpperCase().includes('DEMO') || String(t.name || '').includes('演示')) ||
      tasks.value.find((t) => String(t.status || '') === 'submitted') ||
      tasks.value[0]
    if (demo?.id != null) {
      await selectTask(demo.id)
      message.value = '已载入任务 #' + demo.id + '，可继续规划步骤或地图上图'
    }
  }
})

async function applyRouteTaskQuery() {
  const raw = route.query.taskId
  if (raw == null || raw === '') return
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(id)) return
  // avoid re-entry when setTab writes the same taskId
  if (taskId.value === id && taskStatus.value) return
  try {
    await selectTask(id)
    message.value = '已根据地图跳转载入任务 #' + id
  } catch {
    /* optional */
  }
}

function applyRouteCoordHint() {
  const lon = Number(Array.isArray(route.query.lon) ? route.query.lon[0] : route.query.lon)
  const lat = Number(Array.isArray(route.query.lat) ? route.query.lat[0] : route.query.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  // seed a small study area if empty so user can create task near map click
  if (!researchAreaGeoJson.value) {
    const d = 0.08
    researchAreaGeoJson.value = {
      type: 'Polygon',
      coordinates: [[
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ]],
    }
    message.value = `已根据地图点击预填研究区（${lon.toFixed(4)}, ${lat.toFixed(4)} 附近）`
  }
}

watch(user, async (u) => {
  if (u) await ensureListsLoaded()
})

watch(
  shellSelected,
  (v) => {
    if (!v || v.kind !== 'task') return
    const id = Number(v.id)
    if (!Number.isFinite(id)) return
    if (taskId.value === id) return
    // 地图点选任务 -> 同步规划工作台
    void selectTask(id)
  },
)

watch(() => route.query.tab, () => {
  syncTab()
  if (tab.value === 'candidates' && taskId.value != null) {
    void loadCandidates(false, false)
  }
})
watch(() => route.query.taskId, () => { void applyRouteTaskQuery() })
watch(instanceId, () => { syncFromSelectedInstance() })


async function locateTaskOnMap(id: string | number | unknown, options?: { silent?: boolean }) {
  setShellVisibility({ showSensors: true, showData: false, showTasks: true })
  const ok = await selectShellFeature('task', String(id), { openBubble: true, fly: true })
  if (options?.silent) return ok
  message.value = ok
    ? `已在地图定位观测任务 #${id}`
    : `地图未找到任务 #${id} 的空间范围`
  if (!ok) error.value = message.value
  else error.value = null
  return ok
}
async function locateCandidateOnMap(c: Record<string, unknown>) {
  const pid = c.platformId ?? c.id
  if (pid == null) return
  setShellVisibility({ showSensors: true, showTasks: true, showData: false })
  await selectShellFeature('sensor', String(pid), { openBubble: true, fly: true })
  message.value = `已在地图定位候选资源 #${pid}`
}



async function pickTaskFromSelect(ev: Event) {
  const el = ev.target as HTMLSelectElement | null
  const v = el?.value
  if (!v) return
  await selectTask(v)
}

async function showTasksOnMap() {
  await showPlanningWorkspace('/planning')
  message.value = `地图已加载任务 ${shellCounts.tasks} · 传感器 ${shellCounts.sensors}`
}

async function showCandidatesOnMap() {
  if (taskId.value == null) {
    error.value = '请先选择任务'
    return
  }
  if (!candidateRows.value.length) {
    await loadCandidates(false)
  }
  const links = candidateRows.value.map((c) => ({
    platformId: (c.platformId ?? c.id) as string | number,
    score: Number(c.score ?? 0),
    mode: 'candidate' as const,
    name: String(c.platformName || c.name || c.platformId || ''),
  }))
  const n = await drawAssociationLinks(taskId.value, links, { fit: true, ensureLayers: true })
  message.value = n
    ? `地图已展示候选 ${n} 个`
    : '当前无候选资源'
}


function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function buildLinksFromOptPayload(data: unknown, mode: 'optimized' | 'supplement') {
  const root = asRec(data)
  const results = Array.isArray(root.results) ? (root.results as Record<string, unknown>[]) : []
  const links: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const item of results) {
    const after = asRec(item.after)
    const selectedIds = (item.selectedResourceIds || item.addedResourceIds || after.resourceIds || []) as unknown[]
    const ids = selectedIds.map((x) => String(x))
    // candidates may hold scores
    const snap = asRec(item.inputSnapshot)
    const cands = Array.isArray(snap.candidates)
      ? (snap.candidates as Record<string, unknown>[])
      : Array.isArray(snap.supplementCandidates)
        ? (snap.supplementCandidates as Record<string, unknown>[])
        : []
    const candByPlat = new Map<string, Record<string, unknown>>()
    for (const c of cands) candByPlat.set(String(c.platformId ?? c.id), c)
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      const c = candByPlat.get(id) || {}
      links.push({
        platformId: Number(id) || id,
        id: Number(id) || id,
        score: Number(c.score ?? after.totalScore ?? 0),
        matched: true,
        mode,
        platformName: String(c.platformName || c.name || ('平台#' + id)),
        name: String(c.platformName || c.name || ('平台#' + id)),
        reason: mode === 'optimized' ? '优化筛选入选' : '增补入选',
      })
    }
  }
  return links
}

async function showAssociationOnMap(mode: 'basic' | 'optimized' | 'supplement', opts?: { silent?: boolean }) {
  if (taskId.value == null) {
    error.value = '请先选择任务'
    return
  }
  const label0 =
    mode === 'basic' ? '基础关联(蓝)' : mode === 'optimized' ? '优化关联(绿)' : '增补关联(橙)'
  if (!opts?.silent) message.value = `正在绘制${label0}…`
  error.value = null
  let matches: Array<Record<string, unknown>> = []

  const modeHint: Record<string, string[]> = {
    basic: ['basic', 'base', 'foundation', '基础'],
    optimized: ['optim', 'optimized', 'optimize', '优化'],
    supplement: ['supple', 'supplement', 'augment', '增补'],
  }
  const hints = modeHint[mode] || []

  const planTypeMatches = (planLike: Record<string, unknown>) => {
    // 后端优化/增补多写在 status，planType 常仍为 basic
    const raw = [
      planLike.planType,
      planLike.status,
      planLike.associationMode,
      planLike.mode,
      planLike.type,
    ]
      .map((x) => String(x || '').toLowerCase())
      .join(' ')
    if (!raw.trim()) return true
    return hints.some((h) => raw.includes(h.toLowerCase()))
  }

  // 优先使用本会话优化/增补结果（含 selectedResourceIds）
  if (mode === 'optimized' && lastOptLinks.value.length) {
    matches = lastOptLinks.value.slice()
  } else if (mode === 'supplement' && lastSupLinks.value.length) {
    matches = lastSupLinks.value.slice()
  }

  const collectMatches = (rm: unknown, planLike: Record<string, unknown> | null = null) => {
    if (planLike && !planTypeMatches(planLike)) return
    if (!Array.isArray(rm)) return
    for (const row of rm as Array<Record<string, unknown>>) {
      // only matched resources
      if (row.matched === false) continue
      const rowMode = String(row.mode || row.associationMode || row.planType || '').toLowerCase()
      if (rowMode && !hints.some((h) => rowMode.includes(h.toLowerCase()))) continue
      matches.push(row)
    }
  }

  const pr = planResult.value as Record<string, unknown> | null
  if (!matches.length && pr) {
    const planObj = (pr.plan || pr) as Record<string, unknown>
    collectMatches(planObj.resourceMatches, planObj)
    collectMatches(pr.resourceMatches, pr)
    const planList = Array.isArray(pr.plans) ? (pr.plans as Array<Record<string, unknown>>) : []
    for (const pl of planList) collectMatches(pl.resourceMatches, pl)
  }

  if (!matches.length) {
    for (const pl of plans.value) {
      if (String(pl.taskId) !== String(taskId.value)) continue
      collectMatches(pl.resourceMatches, pl)
    }
  }

  // 列表无嵌套匹配时，优先拉取与当前 mode 匹配的方案结果
  if (!matches.length) {
    const taskPlans = plans.value.filter((pl) => String(pl.taskId) === String(taskId.value))
    const ranked = [...taskPlans].sort((a, b) => {
      const score = (pl: Record<string, unknown>) => {
        const t = String(pl.planType || pl.status || pl.associationMode || pl.mode || pl.type || '').toLowerCase()
        if (mode === 'basic' && (t.includes('basic') || t.includes('base') || t.includes('基础') || !t)) return 2
        if (mode === 'optimized' && (t.includes('optim') || t.includes('优化'))) return 2
        if (mode === 'supplement' && (t.includes('supple') || t.includes('增补') || t.includes('complete'))) return 2
        return 0
      }
      return score(b) - score(a)
    })
    for (const planRow of ranked) {
      if (planRow?.id == null) continue
      try {
        const res = await api.getAssociationResult(String(planRow.id))
        planResult.value = res.data
        const data = res.data as Record<string, unknown>
        const planObj = (data.plan || data) as Record<string, unknown>
        collectMatches(planObj.resourceMatches, planObj)
        collectMatches(data.resourceMatches, data)
        if (matches.length) break
      } catch {
        /* try next plan */
      }
    }
  }

  // 刷新后无会话缓存：从优化任务 resultJson 还原选中资源
  if (!matches.length && (mode === 'optimized' || mode === 'supplement')) {
    try {
      const res = await api.listOptimizationTasks()
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []
      const taskPlans = plans.value.filter((pl) => String(pl.taskId) === String(taskId.value))
      const planIds = new Set(taskPlans.map((p) => String(p.id)))
      const related = rows
        .filter((r) => planIds.has(String(r.planId)))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      for (const row of related) {
        let payload: Record<string, unknown> = {}
        const rj = row.resultJson
        if (typeof rj === 'string' && rj) {
          try { payload = JSON.parse(rj) as Record<string, unknown> } catch { payload = {} }
        } else if (rj && typeof rj === 'object') {
          payload = rj as Record<string, unknown>
        }
        const ids = (payload.selectedResourceIds || payload.addedResourceIds || []) as unknown[]
        if (!ids.length) continue
        const built = ids.map((id) => ({
          platformId: Number(id) || id,
          id: Number(id) || id,
          score: Number(payload.after && (payload.after as any).totalScore || row.bestFitness || 0),
          matched: true,
          mode,
          platformName: '平台#' + id,
          name: '平台#' + id,
          reason: mode === 'optimized' ? '优化筛选入选' : '增补入选',
        }))
        matches = built as Array<Record<string, unknown>>
        if (mode === 'optimized') lastOptLinks.value = matches
        else lastSupLinks.value = matches
        break
      }
    } catch {
      /* optional */
    }
  }

  if (!matches.length && candidateRows.value.length && mode === 'basic') {
    matches = candidateRows.value.filter((c) => c.matched !== false)
  }

  // 若会话里有优化/增补选中 ID，则收窄匹配集合
  if (mode === 'optimized' || mode === 'supplement') {
    const meta = mode === 'optimized' ? lastOptMeta.value : lastSupMeta.value
    const idSet = new Set<string>()
    const results = Array.isArray(asRec(meta).results) ? (asRec(meta).results as Record<string, unknown>[]) : []
    for (const item of results) {
      for (const id of (item.selectedResourceIds || item.addedResourceIds || asRec(item.after).resourceIds || []) as unknown[]) {
        idSet.add(String(id))
      }
    }
    if (idSet.size && matches.length) {
      const filtered = matches.filter((m) => idSet.has(String(m.platformId ?? m.id)))
      if (filtered.length) matches = filtered
    }
  }

  const links = matches.map((c) => ({
    platformId: (c.platformId ?? c.id) as string | number,
    score: Number(c.score ?? scoreOf(c) ?? 0),
    mode,
    name: String(c.platformName || c.name || c.platformId || ''),
    reason: explainOf(c) !== '-' ? explainOf(c) : undefined,
  }))
  const label =
    mode === 'basic' ? '基础关联(蓝)' : mode === 'optimized' ? '优化关联(绿)' : '增补关联(橙)'
  try {
    const n = await drawAssociationLinks(taskId.value, links, { fit: true, ensureLayers: true })
    if (!opts?.silent) {
      if (n) {
        message.value = `已绘制${label} 连线 ${n} 条`
      } else if (!matches.length) {
        message.value =
          mode === 'basic'
            ? `无${label}可展示：请先执行「基础关联」生成方案，或确认候选资源有坐标`
            : `无${label}可展示：请先在流程中执行对应关联步骤生成方案（当前任务可能只有基础方案）`
      } else {
        message.value = `无${label}可展示（匹配 ${matches.length}，可上图坐标 ${links.length}；请确认传感器有位置）`
      }
    }
  } catch (err) {
    error.value = errMessage(err, `${label}上图失败`)
    if (!opts?.silent) message.value = error.value
  }
}

async function drawPlanningCoverageFromEval() {
  if (taskId.value == null) {
    error.value = '请先选择任务'
    return
  }
  // 页面刷新后 evalResult 为空：按当前任务即时拉取评估结果再上图
  if (!evalResult.value) {
    try {
      message.value = '正在拉取满足度评估结果…'
      const res = await api.requirementEvaluation(taskId.value)
      evalResult.value = res.data
    } catch (err) {
      error.value = errMessage(err, '请先执行满足度评估')
      return
    }
  }
  const er = evalResult.value as {
    overallCoverage?: Record<string, unknown>
    task?: { researchAreaGeoJson?: SimpleGeometry | null }
  } | null
  const oc = er?.overallCoverage || {}
  const r = await drawPlanningCoverageOverlay({
    taskGeoJson: researchAreaGeoJson.value || er?.task?.researchAreaGeoJson,
    coverageWkt: String(oc.coverageWkt || ''),
    gapWkt: String(oc.gapWkt || ''),
    fit: true,
  })
  message.value =
    r.task + r.coverage + r.gap > 0
      ? `已上图：任务区${r.task} / 覆盖${r.coverage} / 缺口${r.gap}`
      : '评估结果中暂无可展示的覆盖或缺口范围'
  error.value = null
}

async function clearPlanningCoverageOnMap() {
  await clearPlanningCoverageOverlay()
  message.value = '已清除规划覆盖图层'
}

async function clearMapLinks() {
  await clearAssociationLinks()
  message.value = '已清除关联线'
}
</script>

<template>
  <section class="page">
    <header class="page-head plan-head">
      <div class="plan-head-main">
        <div>
          <p class="eyebrow">观测规划中心</p>
          <h1>任务建模到方案输出的规划流程</h1>
          <p class="muted">按步骤：建模 → 需求 → 候选 → 评分 → 关联 → 方案。上图≠执行。</p>
        </div>
        <div class="plan-head-actions">
          <button class="btn ghost" type="button" @click="resetForm">新建任务</button>
          <button class="btn ghost" type="button" :disabled="taskId == null || pending" @click="openOnMap">定位当前任务</button>
        </div>
      </div>
      <div class="plan-map-actions panel soft" aria-label="地图联动">
        <strong style="font-size:12px;margin-right:0.35rem">地图联动</strong>
        <button class="btn ghost" type="button" :disabled="pending" @click="showTasksOnMap">任务/资源上图</button>
        <button class="btn ghost" type="button" :disabled="pending || taskId == null" @click="showCandidatesOnMap">候选上图</button>
        <button class="btn ghost" type="button" :disabled="pending || taskId == null" @click="showAssociationOnMap('basic')">基础关联(蓝)</button>
        <button class="btn ghost" type="button" :disabled="pending || taskId == null" @click="showAssociationOnMap('optimized')">优化关联(绿)</button>
        <button class="btn ghost" type="button" :disabled="pending || taskId == null" @click="showAssociationOnMap('supplement')">增补关联(橙)</button>
        <button class="btn ghost" type="button" :disabled="pending || taskId == null" @click="drawPlanningCoverageFromEval">覆盖/缺口上图</button>
        <button class="btn ghost" type="button" @click="clearMapLinks">清关联线</button>
        <button class="btn ghost" type="button" @click="clearPlanningCoverageOnMap">清覆盖</button>
        <span class="muted" style="font-size:12px">{{ shellStatus }}</span>
      </div>
    </header>

    <template v-if="user == null">
      <p class="error">需要登录。请先 <RouterLink to="/login?redirect=/planning">登录</RouterLink>。</p>
    </template>
    <template v-else>
      <div class="tabs">
        <button v-for="t in tabs" :key="t.key" type="button" class="tab" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="message" class="ok-text">{{ message }}</p>
      <p v-if="hasTask" class="hint">当前任务 #{{ taskId }} · 状态 {{ taskStatus || '—' }} · 当前步骤 {{ currentStep }}</p>

      <div v-if="user && tab !== 'flow' && hasTask" class="panel soft" style="margin:0.35rem 0;padding:0.45rem 0.55rem;display:flex;gap:0.5rem;align-items:center;justify-content:space-between">
        <span class="muted" style="font-size:12px">当前任务 #{{ taskId }} · 步骤 {{ STEPS.find((x) => x.key === currentStep)?.title || currentStep }}</span>
        <button class="btn ghost" type="button" @click="setTab('flow')">进入需求与关联</button>
      </div>
      <div v-if="currentAction && tab === 'flow'" class="current-action-bar panel soft sticky-action" data-testid="planning-primary-bar">
        <div style="min-width:0;flex:1">
          <strong>
            <template v-if="doneSteps.has(currentAction.action) && currentStep === currentAction.action && currentAction.action === 'output'">
              流程已完成 · {{ currentAction.label }}
            </template>
            <template v-else-if="doneSteps.has(currentAction.action) && currentStep === currentAction.action">
              本步已完成 · {{ currentAction.label }}
            </template>
            <template v-else>当前应执行：{{ currentAction.label }}</template>
          </strong>
          <p class="muted" style="margin:0.2rem 0 0">
            <template v-if="taskId">任务 #{{ taskId }} · 状态 {{ taskStatus || '—' }} · 步骤 {{ STEPS.find((x) => x.key === currentStep)?.title || currentStep }}</template>
            <template v-else>尚未选择任务：请先填写下方表单并执行创建，或从任务列表选择</template>
          </p>
          <p v-if="stepBlockedReason(currentAction.action)" class="error" style="margin:0.25rem 0 0;font-size:12px">
            {{ stepBlockedReason(currentAction.action) }}
          </p>
          <p v-else class="muted" style="margin:0.25rem 0 0;font-size:12px">
            <template v-if="doneSteps.has('output')">规划输出已生成；可切换到「方案管理」做审核/发布，或重新生成输出。</template>
            <template v-else>执行后将更新左侧结果，并尽量同步地图关联/覆盖图层</template>
          </p>
        </div>
        <button
          class="btn"
          type="button"
          data-action-primary="1"
          :data-action="currentAction.action"
          :disabled="canRun(currentAction.action) === false"
          :title="stepBlockedReason(currentAction.action) || currentAction.label"
          @click="runCurrentStep"
        >{{ pending ? '处理中…' : currentAction.label }}</button>
      </div>


      <div v-if="user" class="panel soft task-picker-bar" data-testid="planning-task-picker" style="margin:0.35rem 0;padding:0.5rem 0.6rem;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
        <strong style="font-size:12px">任务选择</strong>
        <select
          class="task-pick-select"
          style="min-width:220px;flex:1;max-width:420px"
          :value="taskId == null ? '' : String(taskId)"
          @change="pickTaskFromSelect"
        >
          <option value="">请选择已有观测任务…</option>
          <option v-for="t in tasks" :key="String(t.id)" :value="String(t.id)">
            #{{ t.id }} · {{ t.name || t.code || '未命名' }} · {{ t.status || '-' }}
          </option>
        </select>
        <button class="btn ghost" type="button" @click="setTab('tasks')">任务列表</button>
        <button class="btn ghost" type="button" @click="resetForm">新建任务</button>
        <span v-if="taskId" class="muted" style="font-size:12px">当前 #{{ taskId }} · {{ taskStatus || '—' }}</span>
        <span v-else class="muted" style="font-size:12px">未选任务时无法执行候选/关联/上图</span>
      </div>

      <section v-if="tab === 'tasks'" class="panel">
        <h2>观测任务列表</h2>
        <table class="table">
          <thead><tr><th>ID</th><th>编码</th><th>名称</th><th>状态</th><th>指标</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!tasks.length">
              <td colspan="6" class="muted">
                暂无观测任务。
                <button class="btn ghost" type="button" style="margin-left:0.35rem" @click="setTab('flow')">去创建任务</button>
              </td>
            </tr>
            <tr v-for="t in tasks" :key="String(t.id)" class="row-click" :class="{ selected: taskId != null && String(taskId) === String(t.id) }" @click.stop="selectTask(t.id)">
              <td>{{ t.id }}</td>
              <td><code>{{ t.code }}</code></td>
              <td>{{ t.name }}</td>
              <td>{{ t.status }}</td>
              <td>{{ Array.isArray(t.indicatorInstanceIds) ? t.indicatorInstanceIds.join(',') : '-' }}</td>
              <td class="ops">
                <button class="btn ghost" type="button" @click.stop="selectTask(t.id)">选择并继续</button>
                <button class="btn ghost" type="button" :disabled="pending" @click.stop="removeTask(t.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'flow'">
        <div class="stepper panel soft">
          <div
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="step-item"
            :class="{
              current: currentStep === s.key,
              done: doneSteps.has(s.key) || stepIndex > i,
              blocked: !doneSteps.has(s.key) && currentStep !== s.key && stepIndex < i && !(s.key === 'create' && taskId == null),
            }"
            role="button"
            tabindex="0"
            :title="stepBlockedReason(s.key) || s.desc"
            @click="onStepClick(s.key)"
            @keydown.enter.prevent="onStepClick(s.key)"
          >
            <div class="step-title">{{ s.title }}</div>
            <div class="step-desc">{{ s.desc }}</div>
            <div v-if="stepBlockedReason(s.key)" class="step-lock">{{ stepBlockedReason(s.key) }}</div>
          </div>
        </div>
        <p v-if="taskId" class="muted" style="margin: 0.35rem 0 0.6rem">
          当前步骤：{{ STEPS.find((x) => x.key === currentStep)?.title || currentStep }}；
          已完成 {{ doneSteps.size }} 步。点击已完成步骤可回看/重跑。上方「…上图」只刷新地图；下方「执行…」才真正推进流程。
        </p>

        <div class="grid-2">
          <section class="panel">
            <h2>观测任务草稿与空间配置</h2>
            <div class="form">
              <p v-if="taskCode" class="task-code">任务编号 {{ taskCode }}</p>
              <label>任务名称<input v-model="taskName" :disabled="hasTask && !canEditDraft" /></label>
              <label>观测目标<textarea v-model="observationTarget" :disabled="hasTask && !canEditDraft" rows="3" /></label>
              <div class="form-row">
                <label>优先级
                  <select v-model="priority" :disabled="hasTask && !canEditDraft">
                    <option value="high">高</option>
                    <option value="normal">常规</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <label>开始时间<input v-model="taskTimeStart" type="datetime-local" :disabled="hasTask" /></label>
                <label>结束时间<input v-model="taskTimeEnd" type="datetime-local" :disabled="hasTask" /></label>
              </div>
              <p class="muted">先保存草稿即可获得系统任务编号；任务区域和指标可随后补充。</p>
              <label>指标实例
                <select v-model="instanceId" :disabled="hasTask && !canEditDraft" @change="syncFromSelectedInstance">
                  <option disabled value="">请选择</option>
                  <option v-for="item in instances" :key="String(item.id)" :value="String(item.id)">#{{ item.id }} {{ item.instanceName }}</option>
                </select>
              </label>
              <p class="muted">实例时间窗：{{ selectedInstanceWindow || '—' }}（创建任务将自动采用）</p>
              <label>尺度
                <select v-model="scaleId" :disabled="hasTask && !canEditDraft">
                  <option disabled value="">请选择</option>
                  <option v-for="s in scales" :key="'sc'+s.id" :value="String(s.id)">{{ s.name }}</option>
                </select>
              </label>
              <div class="area-control" :class="{ ready: researchAreaGeoJson }">
                <div>
                  <strong>任务区域</strong>
                  <p>{{ researchAreaStatus }}。使用地图工具绘制多边形，双击结束。</p>
                </div>
                <button class="btn ghost" type="button" :disabled="hasTask && !canEditDraft" @click="applyMapDrawGeometry">
                  {{ researchAreaGeoJson ? '采用新的绘制范围' : '采用地图绘制范围' }}
                </button>
              </div>
              <div class="form-row">
                <label>空间分辨率<input v-model.number="resolution" type="number" :disabled="hasTask && !canEditDraft" /></label>
                <label>时间分辨率<input v-model="temporalRes" :disabled="hasTask && !canEditDraft" /></label>
              </div>
              <div class="form-row">
                <label>目标精度<input v-model.number="targetAccuracy" type="number" :disabled="hasTask && !canEditDraft" /></label>
                <label>最低覆盖率<input v-model.number="minCoverageRatio" type="number" step="0.01" :disabled="hasTask && !canEditDraft" /></label>
              </div>
              <p class="muted">评分权重（五维之和须为 1，影响候选排序与评分解释）。可先选预设再保存。</p>
              <div class="form-row">
                <button class="btn ghost" type="button" @click="applyWeightPreset('balanced')">预设·均衡</button>
                <button class="btn ghost" type="button" @click="applyWeightPreset('space')">预设·空间优先</button>
                <button class="btn ghost" type="button" @click="applyWeightPreset('capability')">预设·能力优先</button>
                <button class="btn ghost" type="button" @click="applyWeightPreset('reliability')">预设·可靠优先</button>
              </div>
              <div class="form-row">
                <label>主题<input v-model.number="wTheme" type="number" step="0.05" min="0" max="1" /></label>
                <label>空间<input v-model.number="wSpace" type="number" step="0.05" min="0" max="1" /></label>
                <label>时间<input v-model.number="wTime" type="number" step="0.05" min="0" max="1" /></label>
                <label>能力<input v-model.number="wCapability" type="number" step="0.05" min="0" max="1" /></label>
                <label>可靠<input v-model.number="wReliability" type="number" step="0.05" min="0" max="1" /></label>
                <button class="btn ghost" type="button" :disabled="!canEditDraft || pending" @click="saveWeights">保存权重</button>
              </div>
              <button class="btn" type="button" :disabled="!canEditDraft || pending" @click="saveTaskConfiguration">保存任务配置</button>
            </div>
          </section>

          <section class="panel">
            <h2>步骤重跑（高级）</h2>
            <div class="action-stack">
              <button class="btn" type="button" :disabled="canRun('create') === false" :title="stepBlockedReason('create') || '创建观测任务'" data-action="create" @click="createTask">执行创建任务</button>
              <button class="btn ghost" type="button" :disabled="!canEditDraft || pending" @click="saveTaskConfiguration">保存区域与约束</button>
              <button class="btn ghost" type="button" :disabled="taskId == null || pending || (taskStatus !== '' && taskStatus !== 'draft')" @click="bindSelectedIndicator">追加当前指标到任务（仅草稿）</button>
              <button class="btn" type="button" :disabled="canRun('submit') === false" :title="stepBlockedReason('submit') || '提交任务'" data-action="submit" @click="submitTask">执行提交任务</button>
              <button class="btn" type="button" :disabled="canRun('reverse') === false" :title="stepBlockedReason('reverse') || '需求反算'" data-action="reverse" @click="requirementReverse">执行需求反算</button>
              <button class="btn" type="button" :disabled="canRun('candidates') === false" :title="stepBlockedReason('candidates') || '确认候选评分'" data-action="candidates" @click="confirmCandidates">执行候选评分</button>
              <button class="btn" type="button" :disabled="canRun('basic') === false" :title="stepBlockedReason('basic') || '基础关联'" data-action="basic" @click="basicAssociation">执行基础关联</button>
              <button class="btn" type="button" :disabled="canRun('optimize') === false" :title="stepBlockedReason('optimize') || '优化关联'" data-action="optimize" @click="optimizeAssociation">执行优化关联</button>
              <button class="btn" type="button" :disabled="canRun('supplement') === false" :title="stepBlockedReason('supplement') || '增补关联'" data-action="supplement" @click="supplementAssociation">执行增补关联</button>
              <button class="btn" type="button" :disabled="canRun('evaluate') === false" :title="stepBlockedReason('evaluate') || '满足度评估'" data-action="evaluate" @click="requirementEvaluation">执行满足度评估</button>
              <button class="btn" type="button" :disabled="canRun('output') === false" :title="stepBlockedReason('output') || '规划输出'" data-action="output" @click="planningOutput">执行规划输出</button>
              <button class="btn ghost" type="button" :disabled="taskId == null" @click="loadCandidates(true)">查看候选与评分</button>
            </div>
            <p v-if="pending" class="hint">处理中，请勿重复点击…</p>
            <div v-if="hasTask" class="result-bar">
              <span>任务 #{{ taskId }}</span>
              <button class="btn" type="button" @click="openOnMap">在 GIS 查看</button>
            </div>
            <div v-if="reverseSummary" class="panel soft" style="margin-top:0.8rem">
              <h3>需求反算结果（关联前）</h3>
              <p class="muted">可行性 {{ reverseSummary.feasibility }} · 可匹配 {{ reverseSummary.matched }} / 评估 {{ reverseSummary.evaluated }} · 建议平台数 {{ reverseSummary.recommendedTotal }}</p>
              <ul v-if="reverseSummary.recs.length" class="hint-list">
                <li v-for="(r, i) in reverseSummary.recs" :key="'rr'+i">{{ r }}</li>
              </ul>
              <table class="table" v-if="reverseSummary.estimates.length">
                <thead><tr><th>类型</th><th>可匹配</th><th>建议数</th><th>均分</th><th>Top平台</th></tr></thead>
                <tbody>
                  <tr v-for="(e, i) in reverseSummary.estimates" :key="'re'+i">
                    <td>{{ e.platformType }}</td>
                    <td>{{ e.availableMatched }}</td>
                    <td>{{ e.recommendedCount }}</td>
                    <td>{{ e.avgScore ?? '-' }}</td>
                    <td class="clamp">{{ Array.isArray(e.topPlatformNames) ? e.topPlatformNames.join(', ') : '-' }}</td>
                  </tr>
                </tbody>
              </table>
              <details>
                <summary>原始 JSON</summary>
                <pre class="result-pre">{{ businessResultText(reverseResult, 3000) }}</pre>
              </details>
            </div>
            <div v-if="evalResult" class="panel soft" style="margin-top:0.8rem">
              <h3>满足度评估摘要（关联后）</h3>
              <pre class="result-pre">{{ businessResultText(evalResult) }}</pre>
            </div>
            <div v-if="outputResult" class="panel soft" style="margin-top:0.8rem">
              <h3>规划输出摘要</h3>
              <pre class="result-pre">{{ businessResultText(outputResult) }}</pre>
            </div>
          </section>
        </div>
      </section>

      <section v-if="tab === 'candidates'" class="panel">
        <h2>候选传感器筛选 / 评分与解释</h2>
        <p class="muted">对应任务清单：候选筛选 + 评分与解释。流程中须在需求反算后确认本页，再进入基础关联。</p>
        <button class="btn" type="button" :disabled="taskId == null" @click="loadCandidates(false)">刷新候选</button>
        <p class="muted" v-if="candidateMeta">候选数 {{ candidateMeta.candidateCount ?? candidateRows.length }} · 排除 {{ candidateMeta.excludedCount ?? '-' }}</p>
        <table class="table" v-if="candidateRows.length">
          <thead>
            <tr>
              <th>平台</th>
              <th>标识</th>
              <th>类型</th>
              <th>综合分</th>
              <th>主题</th>
              <th>空间</th>
              <th>时间</th>
              <th>能力</th>
              <th>可靠</th>
              <th>评分依据</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, idx) in candidateRows" :key="idx" class="row-click" @click="locateCandidateOnMap(c)">
              <td>{{ c.platformName || c.platformId }}</td>
              <td><code>{{ c.platformIdentifier || '-' }}</code></td>
              <td>{{ c.platformType || c.typeCode || '-' }}</td>
              <td>
                <div class="stat-bar-row">
                  <span>{{ scoreOf(c) }}</span>
                  <i class="stat-bar" :style="{ width: Math.max(6, Math.min(100, Number(scoreOf(c)) || 0)) + '%' }"></i>
                </div>
              </td>
              <td>{{ dimScore(c, 'theme') }}</td>
              <td>{{ dimScore(c, 'space') }}</td>
              <td>{{ dimScore(c, 'time') }}</td>
              <td>{{ dimScore(c, 'capability') }}</td>
              <td>{{ dimScore(c, 'reliability') }}</td>
              <td class="clamp" :title="explainOf(c)">{{ explainOf(c).slice(0, 160) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-panel">
          <p class="muted">暂无候选资源。请先：选择任务 → 提交 → 需求反算 → 执行候选评分。</p>
          <div class="ops">
            <button class="btn" type="button" :disabled="canRun('candidates') === false" @click="confirmCandidates">执行候选评分</button>
            <button class="btn ghost" type="button" :disabled="taskId == null" @click="loadCandidates(false)">刷新候选</button>
            <button class="btn ghost" type="button" :disabled="taskId == null || pending" @click="showCandidatesOnMap">候选上图</button>
          </div>
        </div>
      
        <h3 style="margin-top:1rem">排除列表（硬约束未通过）</h3>
        <p class="muted">展示被筛选掉的资源及原因，便于解释“为何未入选”。</p>
        <table class="table" v-if="excludedRows.length">
          <thead><tr><th>平台</th><th>类型</th><th>排除原因</th></tr></thead>
          <tbody>
            <tr v-for="(c, idx) in excludedRows.slice(0, 30)" :key="'ex'+idx">
              <td>{{ c.platformName || c.platformId }}</td>
              <td>{{ c.platformType || '-' }}</td>
              <td class="clamp">{{ Array.isArray(c.reasons) ? c.reasons.join('；') : (c.reasons || '-') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">无排除项或尚未刷新候选。</p>
</section>

      <section v-if="tab === 'plans'" class="panel">
        <h2>规划方案管理</h2>
        <p class="muted">方案由任务关联流程生成；支持查看关联结果、复制草稿、审核、发布、归档与方案对比（文档：方案管理）。</p>
        <table class="table">
          <thead><tr><th>ID</th><th>名称</th><th>任务</th><th>类型</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="!plans.length"><td colspan="6" class="muted">暂无方案。请先完成观测规划关联流程生成方案。</td></tr>
            <tr v-for="p in plans" :key="String(p.id)" class="row-click" :class="{ selected: isPlanRowSelected(p) || String(lastCopiedPlanId) === String(p.id) }" @click="onPlanRowClick(p)">
              <td>{{ p.id }}</td>
              <td>{{ p.name }}</td>
              <td>{{ p.taskId }}</td>
              <td>{{ p.planType || '-' }}</td>
              <td>{{ planStatusLabel(p.status) }}</td>
              <td class="ops">
                <button class="btn ghost" type="button" @click.stop="loadPlanResult(p.id)">查看结果</button>
                <button class="btn ghost" type="button" :disabled="pending" @click.stop="doCopyPlan(p.id)">复制</button>
                <button class="btn ghost" type="button" :disabled="!canApprovePlanStatus(planLiveStatus(p.id, p.status)) || pending" :title="canApprovePlanStatus(planLiveStatus(p.id, p.status)) ? '审核通过' : '当前状态不可审核'" @click.stop="doApprovePlan(p.id, p.status)">审核</button>
                <button class="btn ghost" type="button" :disabled="!canPublishPlanStatus(planLiveStatus(p.id, p.status)) || pending" :title="canPublishPlanStatus(planLiveStatus(p.id, p.status)) ? '发布方案' : '请先审核通过后再发布'" @click.stop="doPublishPlan(p.id, p.status)">发布</button>
                <button class="btn ghost" type="button" :disabled="canByStatus(planLiveStatus(p.id, p.status), ['archived']) || pending" @click.stop="doArchivePlan(p.id, p.status)">归档</button>
              </td>
            </tr>
          </tbody>
        </table>
        
        <h3>方案对比</h3>
        <p class="muted">选择两份方案，对比资源匹配集合与评分差异（文档：方案对比）。</p>
        <div class="form-row">
          <label>左方案
            <select v-model="comparePlanLeft">
              <option value="">请选择</option>
              <option v-for="p in plans" :key="'cl'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }} [{{ planStatusLabel(p.status) }}]</option>
            </select>
          </label>
          <label>右方案
            <select v-model="comparePlanRight">
              <option value="">请选择</option>
              <option v-for="p in plans" :key="'cr'+p.id" :value="String(p.id)">#{{ p.id }} {{ p.name }} [{{ planStatusLabel(p.status) }}]</option>
            </select>
          </label>
          <button class="btn" type="button" :disabled="pending" @click="runPlanCompare">开始对比</button>
        </div>
        <div v-if="compareResult" class="compare-panel">
          <div class="compare-grid">
            <div class="compare-card">
              <h4>左方案 #{{ planCompareSide('left').id }} · {{ planCompareSide('left').name || '-' }}</h4>
              <p>状态：{{ planStatusLabel(planCompareSide('left').status) }}</p>
              <p>类型：{{ planCompareSide('left').planType || '-' }}</p>
              <p>任务 / 指标：{{ planCompareSide('left').taskId || '-' }} / {{ planCompareSide('left').instanceId || '-' }}</p>
              <p>匹配数：{{ planCompareSide('left').matchCount ?? '-' }}（命中 {{ planCompareSide('left').matchedCount ?? '-' }}）</p>
              <p>平均分：{{ planCompareSide('left').avgScore ?? '-' }}</p>
            </div>
            <div class="compare-card">
              <h4>右方案 #{{ planCompareSide('right').id }} · {{ planCompareSide('right').name || '-' }}</h4>
              <p>状态：{{ planStatusLabel(planCompareSide('right').status) }}</p>
              <p>类型：{{ planCompareSide('right').planType || '-' }}</p>
              <p>任务 / 指标：{{ planCompareSide('right').taskId || '-' }} / {{ planCompareSide('right').instanceId || '-' }}</p>
              <p>匹配数：{{ planCompareSide('right').matchCount ?? '-' }}（命中 {{ planCompareSide('right').matchedCount ?? '-' }}）</p>
              <p>平均分：{{ planCompareSide('right').avgScore ?? '-' }}</p>
            </div>
          </div>
          <p class="compare-meta">
            共享匹配 {{ asCompareObj(compareResult).sharedMatchCount ?? 0 }}
            · 同任务 {{ asCompareObj(compareResult).sameTask ? '是' : '否' }}
            · 同指标 {{ asCompareObj(compareResult).sameInstance ? '是' : '否' }}
          </p>

          <h4>评分差异</h4>
          <table class="table">
            <thead><tr><th>资源</th><th>左分</th><th>右分</th><th>差值</th></tr></thead>
            <tbody>
              <tr v-if="!planCompareList('scoreDiff').length"><td colspan="4" class="muted">无评分差异项</td></tr>
              <tr v-for="(row, i) in planCompareList('scoreDiff')" :key="'sd'+i">
                <td>{{ row.platformName || ('平台#' + row.platformId) }}</td>
                <td>{{ row.leftScore ?? '-' }}</td>
                <td>{{ row.rightScore ?? '-' }}</td>
                <td :class="scoreDeltaClass(row.delta)">{{ row.delta ?? '-' }}</td>
              </tr>
            </tbody>
          </table>

          <h4>仅左侧资源</h4>
          <table class="table">
            <thead><tr><th>资源</th><th>评分</th><th>命中</th></tr></thead>
            <tbody>
              <tr v-if="!planCompareList('onlyLeft').length"><td colspan="3" class="muted">无</td></tr>
              <tr v-for="(row, i) in planCompareList('onlyLeft')" :key="'ol'+i">
                <td>{{ row.platformName || ('平台#' + row.platformId) }}</td>
                <td>{{ row.score ?? '-' }}</td>
                <td>{{ row.matched ? '是' : '否' }}</td>
              </tr>
            </tbody>
          </table>

          <h4>仅右侧资源</h4>
          <table class="table">
            <thead><tr><th>资源</th><th>评分</th><th>命中</th></tr></thead>
            <tbody>
              <tr v-if="!planCompareList('onlyRight').length"><td colspan="3" class="muted">无</td></tr>
              <tr v-for="(row, i) in planCompareList('onlyRight')" :key="'or'+i">
                <td>{{ row.platformName || ('平台#' + row.platformId) }}</td>
                <td>{{ row.score ?? '-' }}</td>
                <td>{{ row.matched ? '是' : '否' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="planResult" class="compare-card" style="margin-top:12px">
          <h4>当前方案结果摘要</h4>
          <p>方案 #{{ asCompareObj(planResult).id || asCompareObj(planResult).planId || '-' }} · 状态 {{ planStatusLabel(asCompareObj(planResult).status) }}</p>
          <p class="muted">完整 JSON 已折叠展示，便于核对：</p>
          <pre class="result-pre">{{ businessResultText(planResult) }}</pre>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.sticky-action {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0.4rem 0 0.75rem;
}
.sticky-action .btn {
  flex-shrink: 0;
  min-width: 140px;
}
.current-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plan-head h1 { font-size: 16px; margin: 0.15rem 0; }
.plan-map-actions.panel { padding: 0.45rem 0.55rem; }
.task-code {
  width: fit-content;
  margin: 0;
  padding: 0.35rem 0.65rem;
  border-left: 3px solid #39c6b3;
  background: color-mix(in srgb, #39c6b3 12%, transparent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: 0.04em;
}
.area-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem;
  border: 1px dashed color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #1677ff 6%, transparent);
}
.area-control.ready {
  border-style: solid;
  border-color: color-mix(in srgb, #39c6b3 55%, transparent);
  background: color-mix(in srgb, #39c6b3 9%, transparent);
}
.area-control p { margin: 0.25rem 0 0; }
.stepper {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
  max-height: min(42vh, 360px);
  overflow: auto;
}
.ops { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.result-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
@media (max-width: 760px) {
  .area-control { align-items: stretch; flex-direction: column; }
}
</style>
