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
  shellLoading,
  shellSelected,
  shellStatus,
  showPlanningWorkspace,
} from '../gis/mapShell'
import { canByStatus, errMessage, isoNow, pickId } from '../utils/errors'
import { useAuthStore } from '../stores/auth'
import { mapDrawGeometry } from '../gis/mapTools'

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
  { key: 'tasks', label: '任务管理' },
  { key: 'flow', label: '关联流程' },
  { key: 'candidates', label: '候选与评分' },
  { key: 'plans', label: '方案管理' },
]

const instances = ref<Record<string, unknown>[]>([])
const scales = ref<Record<string, unknown>[]>([])
const tasks = ref<Record<string, unknown>[]>([])
const plans = ref<Record<string, unknown>[]>([])
const candidateRows = ref<Record<string, unknown>[]>([])
const excludedRows = ref<Record<string, unknown>[]>([])
const candidateMeta = ref<Record<string, unknown> | null>(null)
const reverseResult = ref<unknown>(null)
const evalResult = ref<unknown>(null)
const outputResult = ref<unknown>(null)
const planResult = ref<unknown>(null)
const comparePlanLeft = ref('')
const comparePlanRight = ref('')
const compareResult = ref<unknown>(null)

const instanceId = ref('')
const scaleId = ref('')
const taskCode = ref('')
const taskName = ref('暴雨观测任务')
const researchAreaWkt = ref('')

function applyMapDrawWkt() {
  const g = mapDrawGeometry.value
  if (!g || !g.wkt) {
    error.value = '请先用地图工具绘面，双击结束'
    return
  }
  if (g.type === 'point' && g.lon != null && g.lat != null) {
    const lon = g.lon
    const lat = g.lat
    const d = 0.08
    researchAreaWkt.value = `POLYGON((${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}))`
  } else {
    researchAreaWkt.value = g.wkt
  }
  message.value = '已将地图绘制范围写入研究区'
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
  await router.replace({ path: '/planning', query: { tab: key } })
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
  // 科学交互：当前步可执行；已完成步骤可重跑；不可跳过未完成步骤
  if (currentStep.value === step) return true
  if (doneSteps.value.has(step)) return true
  return false
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
  if (hasTask.value) return
  const row = instances.value.find((i) => String(i.id) === instanceId.value)
  if (!row) return
  if (row.spatialWkt) researchAreaWkt.value = String(row.spatialWkt)
  if (row.scaleId) scaleId.value = String(row.scaleId)
  if (row.resolution != null) resolution.value = Number(row.resolution)
  if (row.temporalRes) temporalRes.value = String(row.temporalRes)
  if (row.targetAccuracy != null) targetAccuracy.value = Number(row.targetAccuracy)
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
  plans.value = p.data
  preferDemoInstance()
  if (scaleId.value === '' && scales.value[0]) scaleId.value = pickId(scales.value[0])
  syncFromSelectedInstance()
}

async function createTask() {
  if (canRun('create') === false) return
  if (instanceId.value === '' || scaleId.value === '' || taskName.value === '') {
    error.value = '请选择指标实例、尺度，并填写任务名称'
    return
  }
  syncFromSelectedInstance()
  if (!researchAreaWkt.value) {
    error.value = '研究区 WKT 不能为空，请选择带空间范围的指标实例'
    return
  }
  pending.value = true
  error.value = null
  message.value = null
    try { await showPlanningWorkspace('/planning') } catch { /* map refresh optional */ }
  try {
    const inst = instances.value.find((i) => String(i.id) === instanceId.value)
    const created = await api.createTask({
      code: taskCode.value || ('TASK-' + Date.now()),
      name: taskName.value,
      description: '观测规划业务任务',
      taskType: 'manual',
      scaleId: Number(scaleId.value),
      indicatorInstanceIds: [Number(instanceId.value)],
      researchAreaWkt: researchAreaWkt.value,
      timeStart: (inst && inst.timeStart) ? String(inst.timeStart) : isoNow(-30 * 60_000),
      timeEnd: (inst && inst.timeEnd) ? String(inst.timeEnd) : isoNow(5 * 3600_000),
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
    const data = created.data as { id: number; status?: string }
    taskId.value = data.id
    taskStatus.value = data.status || 'created'
    setLastTaskId(data.id)
    markDone('create')
    advanceTo('submit')
    message.value = '任务已创建 #' + data.id + '，请提交任务'
    try { await showPlanningWorkspace('/planning') } catch { /* map refresh optional */ }
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '创建任务失败')
  } finally {
    pending.value = false
  }
}

async function submitTask() {
  if (canRun('submit') === false || taskId.value == null) return
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
    await loadCandidates(true)
    markDone('candidates')
    if (STEP_ORDER.indexOf(currentStep.value) <= STEP_ORDER.indexOf('candidates')) {
      advanceTo('basic')
    }
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
    await api.optimizeAssociation(taskId.value)
    markDone('optimize')
    advanceTo('supplement')
    message.value = '优化关联完成'
    await loadLists()
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const res = await api.getAssociationResult(String(planRow.id))
        planResult.value = res.data
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
    await api.supplementAssociation(taskId.value)
    markDone('supplement')
    advanceTo('evaluate')
    message.value = '增补关联完成'
    await loadLists()
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const res = await api.getAssociationResult(String(planRow.id))
        planResult.value = res.data
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
        taskWkt: researchAreaWkt.value || String((res.data as { task?: { researchAreaWkt?: string } })?.task?.researchAreaWkt || ''),
        coverageWkt: String(oc.coverageWkt || ''),
        gapWkt: String(oc.gapWkt || ''),
        fit: true,
      })
    } catch { /* map optional */ }
    markDone('evaluate')
    advanceTo('output')
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
      task?: { researchAreaWkt?: string }
      summary?: { overall?: { coverageWkt?: string; gapWkt?: string } }
    }
    try {
      await drawPlanningCoverageOverlay({
        taskWkt: String(data.task?.researchAreaWkt || researchAreaWkt.value || ''),
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
      tab.value = 'candidates'
      await router.replace({ path: '/planning', query: { tab: 'candidates' } })
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
  const statuses = taskPlans.map((p) => String(p.status || '').toLowerCase())
  if (statuses.some((s) => s.includes('complete') || s === 'completed' || s.includes('supplement'))) {
    return 'evaluate'
  }
  if (statuses.some((s) => s.includes('optim'))) {
    return 'supplement'
  }
  if (statuses.some((s) => s.includes('basic') || s === 'draft' || s === 'created' || s === 'basic_completed')) {
    return 'optimize'
  }
  return inferStepFromStatus(status)
}

async function selectTask(id: unknown) {
  void locateTaskOnMap(String(id as string | number))

  const tid = Number(id)
  if (Number.isFinite(tid) === false) return
  taskId.value = tid
  setLastTaskId(tid)
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
    if (data.researchAreaWkt) researchAreaWkt.value = String(data.researchAreaWkt)
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
    // 若已有方案，说明候选/反算至少可视为已走过
    if (taskPlans.length) {
      done.add('reverse')
      done.add('candidates')
      done.add('basic')
    }
    doneSteps.value = done
    advanceTo(inferred)
    message.value =
      '已选择任务 #' +
      tid +
      ' · 状态 ' +
      (taskStatus.value || '-') +
      ' · 方案 ' +
      taskPlans.length +
      ' · 下一步 ' +
      inferred
    tab.value = 'tasks'
    // 选中任务后自动上图：有方案则画关联线，否则尝试候选资源
    try {
      if (taskPlans.some((p) => Array.isArray(p.resourceMatches) && p.resourceMatches.length)) {
        planResult.value = taskPlans[0] as Record<string, unknown>
        await showAssociationOnMap('basic')
      } else {
        await loadCandidates(false)
        if (candidateRows.value.length) await showCandidatesOnMap()
      }
    } catch {
      /* map overlay optional */
    }
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
    if (taskId.value != null && String(taskId.value) === String(id)) resetForm()
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


function resetForm() {
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
  taskCode.value = 'TASK-' + Date.now()
}

async function loadPlanResult(planId: unknown) {
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
      const ptype = String(plan?.planType || plan?.status || '').toLowerCase()
      let mode: 'basic' | 'optimized' | 'supplement' = 'basic'
      if (ptype.includes('optim')) mode = 'optimized'
      else if (ptype.includes('supple')) mode = 'supplement'
      await showAssociationOnMap(mode)
      if (taskId.value != null) {
        await selectShellFeature('task', String(taskId.value), { openBubble: true, fly: true })
      }
    } catch {
      /* map optional */
    }
    message.value = '已加载方案 #' + planId + ' 并同步地图关联'
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

async function doPublishPlan(planId: unknown, status?: unknown) {
  if (canByStatus(status, ['published'])) {
    error.value = '方案已发布，无需重复操作'
    return
  }
  if (canByStatus(status, ['archived'])) {
    error.value = '已归档方案不能发布'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.publishPlan(String(planId))
    message.value = '方案 #' + planId + ' 已发布'
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '方案发布失败')
  } finally {
    pending.value = false
  }
}

async function doArchivePlan(planId: unknown, status?: unknown) {
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
    const data = res.data as { id?: number }
    message.value = '方案已复制为草稿 #' + String(data.id ?? '')
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '复制方案失败')
  } finally {
    pending.value = false
  }
}



async function doApprovePlan(planId: unknown, status?: unknown) {
  if (canByStatus(status, ['published', 'archived', 'approved'])) {
    error.value = '该方案不可审核（已审核/已发布/已归档）'
    return
  }
  pending.value = true
  error.value = null
  try {
    await api.approvePlan(String(planId))
    message.value = '方案 #' + planId + ' 已审核通过'
    await loadLists()
  } catch (err) {
    error.value = errMessage(err, '审核失败')
  } finally {
    pending.value = false
  }
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
  taskCode.value = 'TASK-' + Date.now()
  await ensureListsLoaded()
})

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

watch(() => route.query.tab, syncTab)
watch(instanceId, () => { syncFromSelectedInstance() })


async function locateTaskOnMap(id: string | number | unknown) {
  setShellVisibility({ showSensors: true, showData: false, showTasks: true })
  const ok = await selectShellFeature('task', String(id), { openBubble: true, fly: true })
  message.value = ok
    ? `已在地图定位观测任务 #${id}`
    : `地图未找到任务 #${id} 的空间范围`
  if (!ok) error.value = message.value
  else error.value = null
}
async function locateCandidateOnMap(c: Record<string, unknown>) {
  const pid = c.platformId ?? c.id
  if (pid == null) return
  setShellVisibility({ showSensors: true, showTasks: true, showData: false })
  await selectShellFeature('sensor', String(pid), { openBubble: true, fly: true })
  message.value = `已加入候选 #${pid}`
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

async function showAssociationOnMap(mode: 'basic' | 'optimized' | 'supplement') {
  if (taskId.value == null) {
    error.value = '请先选择任务'
    return
  }
  let matches: Array<Record<string, unknown>> = []

  const collectMatches = (rm: unknown) => {
    if (!Array.isArray(rm)) return
    for (const row of rm as Array<Record<string, unknown>>) {
      // 仅绘制匹配成功的资源；排除硬约束失败项
      if (row.matched === false) continue
      matches.push(row)
    }
  }

  const pr = planResult.value as Record<string, unknown> | null
  if (pr) {
    const planObj = (pr.plan || pr) as Record<string, unknown>
    collectMatches(planObj.resourceMatches)
    collectMatches(pr.resourceMatches)
    const planList = Array.isArray(pr.plans) ? (pr.plans as Array<Record<string, unknown>>) : []
    for (const pl of planList) collectMatches(pl.resourceMatches)
  }

  if (!matches.length) {
    for (const pl of plans.value) {
      if (String(pl.taskId) !== String(taskId.value)) continue
      collectMatches(pl.resourceMatches)
    }
  }

  // 列表无嵌套匹配时，拉取关联结果详情
  if (!matches.length) {
    const planRow = plans.value.find((pl) => String(pl.taskId) === String(taskId.value))
    if (planRow?.id != null) {
      try {
        const res = await api.getAssociationResult(String(planRow.id))
        planResult.value = res.data
        const data = res.data as Record<string, unknown>
        const planObj = (data.plan || data) as Record<string, unknown>
        collectMatches(planObj.resourceMatches)
        collectMatches(data.resourceMatches)
      } catch {
        /* optional */
      }
    }
  }

  if (!matches.length && candidateRows.value.length && mode === 'basic') {
    matches = candidateRows.value.filter((c) => c.matched !== false)
  }

  const links = matches.map((c) => ({
    platformId: (c.platformId ?? c.id) as string | number,
    score: Number(c.score ?? scoreOf(c) ?? 0),
    mode,
    name: String(c.platformName || c.name || c.platformId || ''),
    reason: explainOf(c) !== '-' ? explainOf(c) : undefined,
  }))
  const n = await drawAssociationLinks(taskId.value, links, { fit: true, ensureLayers: true })
  const label =
    mode === 'basic' ? '基础关联(蓝)' : mode === 'optimized' ? '优化关联(绿)' : '增补关联(橙)'
  message.value = n ? `已绘制${label} 连线 ${n} 条` : `无${label}可展示（请确认已完成关联并存在匹配资源）`
}

async function drawPlanningCoverageFromEval() {
  const er = evalResult.value as { overallCoverage?: Record<string, unknown> } | null
  const oc = er?.overallCoverage || {}
  if (!er) {
    error.value = '请先执行满足度评估'
    return
  }
  const r = await drawPlanningCoverageOverlay({
    taskWkt: researchAreaWkt.value,
    coverageWkt: String(oc.coverageWkt || ''),
    gapWkt: String(oc.gapWkt || ''),
    fit: true,
  })
  message.value =
    r.task + r.coverage + r.gap > 0
      ? `已上图：任务区${r.task} / 覆盖${r.coverage} / 缺口${r.gap}`
      : '评估结果中无有效覆盖几何'
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
    <header class="page-head">
      <div>
        <p class="eyebrow">观测规划中心</p>
        <h1>任务建模到方案输出的规划流程</h1>
        <p class="muted">严格按任务清单分步：创建/提交 → 需求反算 → 候选与评分 → 基础/优化/增补关联 → 满足度评估 → 规划输出。无一键跑通。</p>
      </div>
      <button class="btn ghost" type="button" @click="resetForm">新建任务</button>
      <button class="btn ghost" type="button" :disabled="shellLoading" @click="showTasksOnMap">任务+资源</button>
      <button class="btn ghost" type="button" :disabled="shellLoading || taskId == null" @click="showCandidatesOnMap">候选资源</button>
      <button class="btn ghost" type="button" :disabled="shellLoading || taskId == null" @click="showAssociationOnMap('basic')">基础关联</button>
      <button class="btn ghost" type="button" :disabled="shellLoading || taskId == null" @click="showAssociationOnMap('optimized')">优化关联</button>
      <button class="btn ghost" type="button" :disabled="shellLoading || taskId == null" @click="showAssociationOnMap('supplement')">增补关联</button>
      <button class="btn ghost" type="button" :disabled="shellLoading" @click="clearMapLinks">清除关联</button>
      <button class="btn ghost" type="button" :disabled="shellLoading || !evalResult" @click="drawPlanningCoverageFromEval">覆盖评估上图</button>
      <button class="btn ghost" type="button" :disabled="shellLoading" @click="clearPlanningCoverageOnMap">清除覆盖</button>
      <span class="muted">{{ shellStatus }}</span>
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

      <section v-show="tab === 'tasks'" class="panel">
        <h2>观测任务列表</h2>
        <table class="table">
          <thead><tr><th>ID</th><th>编码</th><th>名称</th><th>状态</th><th>指标</th><th></th></tr></thead>
          <tbody>
            <tr v-for="t in tasks" :key="String(t.id)" class="row-click" :class="{ selected: shellSelected && shellSelected.kind === 'task' && shellSelected.id === String(t.id) }" @click.stop="selectTask(t.id)">
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

      <section v-show="tab === 'flow'">
        <div class="stepper panel soft">
          <div
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="step-item"
            :class="{ current: currentStep === s.key, done: doneSteps.has(s.key) || stepIndex > i }"
          >
            <div class="step-title">{{ s.title }}</div>
            <div class="step-desc">{{ s.desc }}</div>
          </div>
        </div>

        <div class="grid-2">
          <section class="panel">
            <h2>任务建模 / 指标实例选择</h2>
            <div class="form">
              <label>任务编码<input v-model="taskCode" :disabled="hasTask" /></label>
              <label>任务名称<input v-model="taskName" :disabled="hasTask" /></label>
              <label>指标实例
                <select v-model="instanceId" :disabled="hasTask">
                  <option disabled value="">请选择</option>
                  <option v-for="item in instances" :key="String(item.id)" :value="String(item.id)">#{{ item.id }} {{ item.instanceName }}</option>
                </select>
        <p class="muted">实例时间窗：{{ selectedInstanceWindow }}（创建任务将自动采用）</p>
              </label>
              <label>尺度
                <select v-model="scaleId" :disabled="hasTask">
                  <option disabled value="">请选择</option>
                  <option v-for="s in scales" :key="'sc'+s.id" :value="String(s.id)">{{ s.name }}</option>
                </select>
              </label>
              <label>研究区 WKT
                <input v-model="researchAreaWkt" :disabled="hasTask" />
                <button class="btn ghost" type="button" :disabled="hasTask" @click="applyMapDrawWkt">写入地图绘制范围</button>
              </label>
              <div class="form-row">
                <label>空间分辨率<input v-model.number="resolution" type="number" :disabled="hasTask" /></label>
                <label>时间分辨率<input v-model="temporalRes" :disabled="hasTask" /></label>
              </div>
              <div class="form-row">
                <label>目标精度<input v-model.number="targetAccuracy" type="number" :disabled="hasTask" /></label>
                <label>最低覆盖率<input v-model.number="minCoverageRatio" type="number" step="0.01" :disabled="hasTask" /></label>
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
                <button class="btn ghost" type="button" :disabled="!hasTask || pending" @click="saveWeights">保存权重</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>分步业务操作</h2>
            <div class="action-stack">
              <button class="btn" type="button" :disabled="canRun('create') === false" @click="createTask">创建任务</button>
              <button class="btn ghost" type="button" :disabled="taskId == null || pending || (taskStatus !== '' && taskStatus !== 'draft')" @click="bindSelectedIndicator">追加当前指标到任务（仅草稿）</button>
              <button class="btn" type="button" :disabled="canRun('submit') === false" @click="submitTask">提交任务</button>
              <button class="btn" type="button" :disabled="canRun('reverse') === false" @click="requirementReverse">需求反算</button>
              <button class="btn" type="button" :disabled="canRun('candidates') === false" @click="confirmCandidates">确认候选评分</button>
              <button class="btn" type="button" :disabled="canRun('basic') === false" @click="basicAssociation">基础关联</button>
              <button class="btn" type="button" :disabled="canRun('optimize') === false" @click="optimizeAssociation">优化关联</button>
              <button class="btn" type="button" :disabled="canRun('supplement') === false" @click="supplementAssociation">增补关联</button>
              <button class="btn" type="button" :disabled="canRun('evaluate') === false" @click="requirementEvaluation">满足度评估</button>
              <button class="btn" type="button" :disabled="canRun('output') === false" @click="planningOutput">规划输出</button>
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
                <pre class="result-pre">{{ JSON.stringify(reverseResult, null, 2).slice(0, 3000) }}</pre>
              </details>
            </div>
            <div v-if="evalResult" class="panel soft" style="margin-top:0.8rem">
              <h3>满足度评估摘要（关联后）</h3>
              <pre class="result-pre">{{ JSON.stringify(evalResult, null, 2).slice(0, 2500) }}</pre>
            </div>
            <div v-if="outputResult" class="panel soft" style="margin-top:0.8rem">
              <h3>规划输出摘要</h3>
              <pre class="result-pre">{{ JSON.stringify(outputResult, null, 2).slice(0, 2500) }}</pre>
            </div>
          </section>
        </div>
      </section>

      <section v-show="tab === 'candidates'" class="panel">
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
              <td>{{ scoreOf(c) }}</td>
              <td>{{ dimScore(c, 'theme') }}</td>
              <td>{{ dimScore(c, 'space') }}</td>
              <td>{{ dimScore(c, 'time') }}</td>
              <td>{{ dimScore(c, 'capability') }}</td>
              <td>{{ dimScore(c, 'reliability') }}</td>
              <td class="clamp" :title="explainOf(c)">{{ explainOf(c).slice(0, 160) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">暂无候选。请先完成提交/关联，再刷新。</p>
      
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

      <section v-show="tab === 'plans'" class="panel">
        <h2>规划方案管理</h2>
        <p class="muted">方案由任务关联流程生成；支持查看关联结果、复制草稿、审核、发布、归档与方案对比（文档：方案管理）。</p>
        <table class="table">
          <thead><tr><th>ID</th><th>名称</th><th>任务</th><th>类型</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="p in plans" :key="String(p.id)" class="row-click" @click="onPlanRowClick(p)">
              <td>{{ p.id }}</td>
              <td>{{ p.name }}</td>
              <td>{{ p.taskId }}</td>
              <td>{{ p.planType || '-' }}</td>
              <td>{{ planStatusLabel(p.status) }}</td>
              <td class="ops">
                <button class="btn ghost" type="button" @click.stop="loadPlanResult(p.id)">查看结果</button>
                <button class="btn ghost" type="button" :disabled="pending" @click.stop="doCopyPlan(p.id)">复制</button>
                <button class="btn ghost" type="button" :disabled="canByStatus(p.status, ['published', 'archived', 'approved']) || pending" @click.stop="doApprovePlan(p.id, p.status)">审核</button>
                <button class="btn ghost" type="button" :disabled="canByStatus(p.status, ['published', 'archived']) || pending" @click.stop="doPublishPlan(p.id, p.status)">发布</button>
                <button class="btn ghost" type="button" :disabled="canByStatus(p.status, ['archived']) || pending" @click.stop="doArchivePlan(p.id, p.status)">归档</button>
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
        <pre v-if="compareResult" class="result-pre">{{ JSON.stringify(compareResult, null, 2).slice(0, 4000) }}</pre>

        <pre v-if="planResult" class="result-pre">{{ JSON.stringify(planResult, null, 2).slice(0, 3500) }}</pre>
      </section>
    </template>
  </section>
</template>
