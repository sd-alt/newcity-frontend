<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import { shellViewer } from '../gis/mapShell'
import { mapDrawGeometry, setMapToolMode } from '../gis/mapTools'
import { AI_PREFERENCES_EVENT, readAiPreferences } from '../utils/aiPreferences'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const router = useRouter()
const route = useRoute()
const scenes = ref<Row[]>([])
const initialPreferences = readAiPreferences()
const mode = ref<'manual' | 'assisted' | 'agent'>(initialPreferences.defaultTaskMode)
const showTechnicalDetails = ref(initialPreferences.showTechnicalDetails)
const sceneId = ref('')
const requirement = ref('监测未来三天某流域洪涝风险，重点关注强降雨、水位上涨和重点河段，要求半小时更新一次。')
const areaWkt = ref('')
const timeStart = ref('')
const timeEnd = ref('')
const updateFrequency = ref('PT30M')
const submitting = ref(false)
const error = ref('')
const message = ref('')
const draft = ref<Row | null>(null)
const run = ref<api.AgentRunData | null>(null)
const followup = ref('')
const followupPanel = ref<HTMLElement | null>(null)
const followupInput = ref<HTMLTextAreaElement | null>(null)
const approvalPanel = ref<HTMLElement | null>(null)
const auditPage = ref(1)
const artifactPage = ref(1)
const cardPageSize = 4
let source: EventSource | null = null
let pollTimer: number | null = null

const modes = [
  { key: 'manual', label: '手动创建', note: '不调用模型，直接保存需求与任务草案' },
  { key: 'assisted', label: 'AI辅助', note: 'AI生成草案，逐阶段人工采用或调整' },
  { key: 'agent', label: '多Agent自动规划', note: 'MAF专业Agent协同，关键节点人工确认' },
] as const
const selectedMode = computed(() => modes.find((item) => item.key === mode.value) || modes[0])
const workflow = computed(() => run.value?.workflow)
const stages = computed(() => workflow.value?.nodes || run.value?.stages || [])
const workflowLevels = computed(() => {
  const groups = new Map<number, api.AgentWorkflowNode[]>()
  stages.value.forEach((item) => {
    const level = Number(item.topologicalLevel || 0)
    groups.set(level, [...(groups.get(level) || []), item])
  })
  return Array.from(groups.entries()).sort(([left], [right]) => left - right).map(([level, nodes]) => ({ level, nodes }))
})
const approvals = computed(() => ((run.value?.pendingApprovals || []) as Row[]).filter((item) => item.status === 'pending'))
const toolCalls = computed(() => (run.value?.toolCalls || []) as Row[])
const artifacts = computed(() => (run.value?.artifacts || []) as Row[])
const reversedToolCalls = computed(() => toolCalls.value.slice().reverse())
const auditPageCount = computed(() => Math.max(1, Math.ceil(reversedToolCalls.value.length / cardPageSize)))
const pagedToolCalls = computed(() => reversedToolCalls.value.slice((auditPage.value - 1) * cardPageSize, auditPage.value * cardPageSize))
const auditPageLabels = computed(() => Array.from({ length: auditPageCount.value }, (_, index) => `工具调用第 ${index + 1} 页`))
const artifactPageCount = computed(() => Math.max(1, Math.ceil(artifacts.value.length / cardPageSize)))
const pagedArtifacts = computed(() => artifacts.value.slice((artifactPage.value - 1) * cardPageSize, artifactPage.value * cardPageSize))
const artifactPageLabels = computed(() => Array.from({ length: artifactPageCount.value }, (_, index) => `阶段成果第 ${index + 1} 页`))
const structured = computed(() => ((run.value as Row | null)?.demand?.structuredRequirement || {}) as Row)
const terminal = computed(() => ['completed', 'failed', 'cancelled', 'manual_required', 'paused'].includes(run.value?.status || ''))
const runId = computed(() => run.value?.id || '')
const currentStageName = computed(() => stages.value.find((item) => item.nodeId === run.value?.currentStage || item.code === run.value?.currentStage)?.name || run.value?.currentStage || '未启动')
const parallelRunningNodes = computed(() => stages.value.filter((item) => item.status === 'running'))
const completedMandatoryNodes = computed(() => stages.value.filter((item) => item.mandatory && item.status === 'completed').length)
const mandatoryNodeCount = computed(() => stages.value.filter((item) => item.mandatory).length)
const workflowModeLabel = computed(() => {
  const labels: Record<string, string> = { 'fixed-maf': '固定基线', 'template-maf': '意图模板', 'dynamic-maf': '动态规划' }
  return labels[workflow.value?.mode || ''] || workflow.value?.mode || '-'
})
const workflowSourceLabel = computed(() => {
  const labels: Record<string, string> = { llm: 'MAF Agent', template: '可信模板', fallback: '安全回退', manual: '人工定义' }
  return labels[workflow.value?.source || ''] || workflow.value?.source || '-'
})

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
function localIso(value: string) { return value ? new Date(value).toISOString() : undefined }
function statusLabel(value: string) { return ({ pending: '待执行', running: '执行中', completed: '已完成', waiting_approval: '待确认', waiting_input: '待补充', failed: '失败', manual_required: '需人工', rejected: '已拒绝', paused: '已暂停' } as Record<string, string>)[value] || value }
function compactJson(value: unknown) {
  const text = JSON.stringify(value || {}, null, 2)
  return text === '{}' ? '暂无' : text
}
async function loadScenes() {
  try {
    const response = await api.listScenes()
    scenes.value = rows(response.data)
    const watershed = scenes.value.find((item) => String(item.code).includes('watershed') || String(item.name).includes('流域'))
    sceneId.value = String((watershed || scenes.value[0] || {}).id || '')
  } catch (cause) { error.value = errMessage(cause, '场景加载失败') }
}
async function submitDemand() {
  if (!sceneId.value || !requirement.value.trim()) { error.value = '请选择场景并填写监测需求'; return }
  submitting.value = true; error.value = ''; message.value = ''; stopTracking()
  try {
    const body = { sceneId: Number(sceneId.value), originalRequirement: requirement.value.trim(), mode: mode.value, areaWkt: areaWkt.value, timeStart: localIso(timeStart.value), timeEnd: localIso(timeEnd.value), updateFrequency: updateFrequency.value }
    if (mode.value === 'manual') {
      const response = await api.createMonitoringDemand(body)
      const data = response.data as Row
      draft.value = { demandId: data.id, taskId: data.draftTaskId, status: data.status, originalRequirement: data.originalRequirement, mode: data.mode }
      run.value = null
      message.value = '手动任务草案已保存；无需模型服务即可继续到任务中心和业务中心配置'
    } else {
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? `web-${crypto.randomUUID()}`
        : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const response = await api.createAgentTask({ ...body, idempotencyKey })
      const data = response.data as Row
      draft.value = { demandId: data.demandId, taskId: data.taskId, runId: data.runId, status: data.status, originalRequirement: requirement.value.trim(), mode: mode.value }
      run.value = data.run as api.AgentRunData
      message.value = '任务草案与 Agent 运行已立即创建，请启动后台 Worker 处理队列'
      startTracking(data.runId)
    }
  } catch (cause) { error.value = errMessage(cause, '任务发起失败') }
  finally { submitting.value = false }
}
function startTracking(id: string) {
  stopTracking()
  source = new EventSource(api.agentRunEventsUrl(id))
  source.addEventListener('run', (event) => {
    const messageEvent = event as MessageEvent
    try {
      run.value = JSON.parse(messageEvent.data) as api.AgentRunData
    } catch {
      error.value = 'Agent 实时状态格式异常，页面将通过轮询继续刷新'
    }
    if (run.value && ['completed', 'failed', 'cancelled', 'manual_required', 'waiting_approval', 'waiting_input', 'paused'].includes(run.value.status)) source?.close()
  })
  source.onerror = () => {
    source?.close()
    void refreshRun(id, true)
  }
  pollTimer = window.setInterval(() => refreshRun(id, true), 2500)
}
function stopTracking() {
  source?.close(); source = null
  if (pollTimer != null) window.clearInterval(pollTimer)
  pollTimer = null
}
async function refreshRun(id = runId.value, quiet = false) {
  if (!id) return
  try {
    const response = await api.getAgentRun(id)
    run.value = response.data
    if (terminal.value || run.value.status === 'waiting_approval' || run.value.status === 'waiting_input') stopTracking()
  } catch (cause) { if (!quiet) error.value = errMessage(cause, '运行状态刷新失败') }
}
async function focusHumanAction() {
  await nextTick()
  const target = run.value?.status === 'waiting_input' ? followupPanel.value : approvalPanel.value
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (run.value?.status === 'waiting_input') followupInput.value?.focus()
}
async function loadRunFromRoute() {
  const value = route.query.runId
  const id = typeof value === 'string' ? value : ''
  if (!id) return
  await refreshRun(id)
  if (!run.value) return
  message.value = '宸插姟鎴愭换鍔¤繍琛岋紝璇锋寜褰撳墠鎻愮ず澶勭悊'
  if (!['completed', 'failed', 'cancelled', 'manual_required', 'waiting_approval', 'waiting_input', 'paused'].includes(run.value.status)) {
    startTracking(id)
  }
  await focusHumanAction()
}
async function control(action: 'pause' | 'resume' | 'retry' | 'cancel' | 'takeover') {
  if (!runId.value) return
  if ((action === 'cancel' || action === 'takeover') && !window.confirm(action === 'cancel' ? '确认取消本次 Agent 运行？' : '确认接管并转为完全手动处理？')) return
  try {
    const response = await api.controlAgentRun(runId.value, action)
    run.value = response.data
    message.value = ({ pause: 'Agent 已暂停', resume: 'Agent 已恢复并重新入队', retry: '失败阶段已重新入队', cancel: 'Agent 运行已取消', takeover: '已转为人工接管' })[action]
    if (action === 'resume' || action === 'retry') startTracking(runId.value)
  } catch (cause) { error.value = errMessage(cause, '运行控制失败') }
}
async function decide(approval: Row, decision: 'approved' | 'rejected') {
  if (decision === 'rejected' && !window.confirm('拒绝后工作流将转为人工处理，是否继续？')) return
  try {
    const response = await api.decideAgentApproval(runId.value, approval.id, decision, decision === 'approved' ? '人工核验通过' : '需要人工调整')
    run.value = response.data
    message.value = decision === 'approved' ? '已人工确认，工作流继续' : '已拒绝并转为人工处理'
    if (decision === 'approved') startTracking(runId.value)
  } catch (cause) { error.value = errMessage(cause, '确认提交失败') }
}
async function sendFollowup() {
  if (!runId.value || !followup.value.trim()) return
  try {
    const response = await api.sendAgentMessage(runId.value, followup.value.trim())
    run.value = response.data; followup.value = ''; message.value = '补充信息已提交，需求理解阶段将重新执行'; startTracking(runId.value)
  } catch (cause) { error.value = errMessage(cause, '补充信息发送失败') }
}
function drawArea() { setMapToolMode(shellViewer.value, 'draw-polygon'); message.value = '请在地图上逐点绘制任务区域，双击结束' }
function clearArea() { areaWkt.value = ''; mapDrawGeometry.value = null; setMapToolMode(shellViewer.value, 'none') }
function openAdjustment(approval: Row) {
  if (approval.type === 'indicator_confirmation') router.push({ path: '/tasks', query: { tab: 'task-systems' } })
  else router.push({ path: '/business', query: { tab: 'flow' } })
}
function applyAiPreferences() {
  const value = readAiPreferences()
  mode.value = value.defaultTaskMode
  showTechnicalDetails.value = value.showTechnicalDetails
}
watch(() => route.query.runId, () => void loadRunFromRoute())
watch(mapDrawGeometry, (geometry) => {
  if (!geometry || geometry.type !== 'polygon') return
  const rings = geometry.geojson.coordinates as number[][][]
  const ring = rings[0]
  if (ring?.length) areaWkt.value = `POLYGON ((${ring.map((point) => `${point[0]} ${point[1]}`).join(', ')}))`
})
onMounted(() => {
  void loadScenes()
  void loadRunFromRoute()
  window.addEventListener(AI_PREFERENCES_EVENT, applyAiPreferences)
})
onUnmounted(() => {
  stopTracking()
  window.removeEventListener(AI_PREFERENCES_EVENT, applyAiPreferences)
})
</script>

<template>
  <section class="page agent-workspace">
    <header class="page-head"><div><p class="eyebrow">场景驱动任务入口</p><h1>综合感知任务</h1></div><span v-if="run" class="run-code">{{ run.id.slice(0, 8) }}</span></header>
    <section class="panel task-launch-card">
      <header class="section-card-head"><h2>创建感知任务</h2><span>先选任务方式，再填写需求</span></header>
      <label class="task-mode-field">任务方式
        <select v-model="mode"><option v-for="item in modes" :key="item.key" :value="item.key">{{ item.label }}</option></select>
        <small>{{ selectedMode.note }}</small>
      </label>
      <div class="demand-form">
        <label>场景<select v-model="sceneId"><option value="">选择场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select></label>
        <label>监测需求<textarea v-model="requirement" rows="5" placeholder="描述对象、区域、时间、目标、约束和成果要求"></textarea></label>
        <div class="split"><label>开始时间<input v-model="timeStart" type="datetime-local" /></label><label>结束时间<input v-model="timeEnd" type="datetime-local" /></label></div>
        <label>更新频次<input v-model="updateFrequency" placeholder="例如 PT30M" /></label>
        <div class="map-input"><span>{{ areaWkt ? '已绘制任务区域' : '可在地图选点、框选或绘制多边形' }}</span><button class="btn tiny" @click="drawArea">绘制区域</button><button v-if="areaWkt" class="btn ghost tiny" @click="clearArea">清除</button></div>
        <button class="btn primary start-button" :disabled="submitting" @click="submitDemand">{{ submitting ? '正在创建任务草案…' : mode === 'manual' ? '创建手动任务草案' : mode === 'assisted' ? '生成 AI 辅助草案' : '启动多Agent自动规划' }}</button>
      </div>
    </section>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>

    <article v-if="draft" class="draft-card"><div><span>任务草案</span><strong>#{{ draft.taskId }} · 需求 #{{ draft.demandId }}</strong><small>{{ draft.mode }} · {{ draft.status }}</small></div><p>{{ draft.originalRequirement }}</p><button v-if="draft.mode === 'manual'" class="btn tiny" @click="router.push({ path: '/tasks', query: { tab: 'task-systems', taskId: draft.taskId, sceneId } })">继续配置任务指标</button></article>

    <template v-if="run">
      <div class="run-summary"><div><span>当前节点</span><strong>{{ currentStageName }}</strong></div><div><span>运行状态</span><strong>{{ statusLabel(run.status) }}</strong></div><div><span>必需节点</span><strong>{{ completedMandatoryNodes }}/{{ mandatoryNodeCount }}</strong></div></div>
      <div class="run-progress"><i :style="{ width: `${Number(run.progress || 0)}%` }"></i></div>
      <div class="run-actions">
        <button v-if="run.status === 'running' || run.status === 'queued'" class="btn tiny" @click="control('pause')">暂停</button>
        <button v-if="run.status === 'paused' || run.status === 'manual_required'" class="btn tiny" @click="control('resume')">恢复</button>
        <button v-if="run.status === 'failed' || run.status === 'manual_required'" class="btn tiny" @click="control('retry')">重试</button>
        <button v-if="run.status !== 'completed' && run.status !== 'cancelled'" class="btn ghost tiny" @click="control('takeover')">人工接管</button>
        <button class="btn ghost tiny" @click="refreshRun()">刷新</button>
        <button v-if="run.status !== 'completed' && run.status !== 'cancelled'" class="btn danger tiny" @click="control('cancel')">取消</button>
      </div>

      <section v-if="workflow" class="workflow-identity" aria-label="Workflow 概览">
        <div class="workflow-title"><div><span>Microsoft Agent Framework</span><strong>{{ workflow.graphType }}</strong><p>{{ workflow.goal }}</p></div><b :class="['workflow-source', workflow.source]">{{ workflowSourceLabel }}</b></div>
        <dl>
          <div><dt>运行模式</dt><dd>{{ workflowModeLabel }}</dd></div>
          <div><dt>图规模</dt><dd>{{ workflow.nodeCount }} 节点 · {{ workflow.edgeCount }} 条边</dd></div>
          <div><dt>并行节点</dt><dd>{{ parallelRunningNodes.length ? parallelRunningNodes.map((item) => item.name).join('、') : '当前无并行执行' }}</dd></div>
          <div><dt>Checkpoint</dt><dd :title="workflow.checkpointId">{{ workflow.checkpointId ? workflow.checkpointId.slice(0, 12) : '等待首次执行' }}</dd></div>
        </dl>
        <p v-if="workflow.fallback" class="workflow-fallback"><strong>已安全回退到可信模板</strong>{{ workflow.fallbackReason }}</p>
      </section>

      <div v-if="Object.keys(structured).length" class="panel structured-card"><h3>已识别需求</h3><dl><div><dt>对象</dt><dd>{{ structured.object || '-' }}</dd></div><div><dt>区域</dt><dd>{{ structured.area || '-' }}</dd></div><div><dt>时间</dt><dd>{{ structured.timeRange?.start || '-' }} → {{ structured.timeRange?.end || '-' }}</dd></div><div><dt>频次</dt><dd>{{ structured.updateFrequency || '-' }}</dd></div><div><dt>感知要素</dt><dd>{{ (structured.sensingElementCodes || []).join('、') || '-' }}</dd></div></dl></div>

      <div v-if="approvals.length" ref="approvalPanel" class="approval-stack"><article v-for="item in approvals" :key="item.id"><span>待人工确认</span><strong>{{ item.title }}</strong><p>{{ item.description }}</p><div><button class="btn ghost tiny" @click="openAdjustment(item)">先人工调整</button><button class="btn danger tiny" @click="decide(item, 'rejected')">拒绝</button><button class="btn primary tiny" @click="decide(item, 'approved')">确认并继续</button></div></article></div>
      <div v-if="run.status === 'waiting_input'" ref="followupPanel" class="panel followup"><strong>补充需求信息</strong><textarea ref="followupInput" v-model="followup" rows="3" placeholder="补充缺失的区域、时间、目标或约束"></textarea><button class="btn primary" @click="sendFollowup">提交并重新分析</button></div>

      <h3 class="block-title">Workflow 拓扑</h3>
      <div class="workflow-map" aria-label="按依赖层级排列的 Workflow 节点">
        <section v-for="group in workflowLevels" :key="group.level" class="workflow-level">
          <header><span>L{{ group.level + 1 }}</span><small>{{ group.nodes.length > 1 ? `${group.nodes.length} 个可并行节点` : group.level === 0 ? '入口' : '依赖层' }}</small></header>
          <div class="workflow-lane">
            <article v-for="item in group.nodes" :key="item.nodeId" :class="['workflow-node', item.status, item.riskLevel, { current: item.nodeId === run.currentStage || item.code === run.currentStage }]">
              <div class="node-head"><span>{{ statusLabel(item.status) }}</span><code>{{ item.nodeType }}</code></div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.agentName || '确定性业务服务' }} · {{ item.executorType }}</small>
              <p>{{ item.planningReason || '由可信工作流模板选择' }}</p>
              <div v-if="item.dependsOn.length" class="node-dependencies"><span>依赖</span>{{ item.dependsOn.join(' · ') }}</div>
              <div v-if="item.toolNames.length || item.allowedToolNames.length" class="node-tools">
                <span v-for="tool in (item.toolNames.length ? item.toolNames : item.allowedToolNames)" :key="tool" :class="{ invoked: item.toolNames.includes(tool) }">{{ tool }}</span>
              </div>
              <details v-if="showTechnicalDetails && (Object.keys(item.inputSummary || {}).length || Object.keys(item.outputSummary || {}).length)">
                <summary>输入 / 输出摘要</summary>
                <pre>输入：{{ compactJson(item.inputSummary) }}
输出：{{ compactJson(item.outputSummary) }}</pre>
              </details>
              <p v-if="item.errorMessage" class="node-error">{{ item.errorMessage }}</p>
            </article>
          </div>
        </section>
      </div>

      <template v-if="showTechnicalDetails">
        <h3 class="block-title">工具调用与数据来源</h3>
        <div v-if="toolCalls.length" class="audit-list"><article v-for="item in pagedToolCalls" :key="item.id"><span>{{ item.status }}</span><strong>{{ item.toolName }}</strong><small>{{ item.source || '业务 Service' }} · {{ item.durationMs }}ms · 对象 {{ JSON.stringify(item.objectIds || {}) }}</small></article></div><div v-else class="empty-state">尚无工具调用记录。后台 Worker 开始处理后会实时显示。</div>
        <CardPager v-model:page="auditPage" kind="records" :pages="auditPageLabels" :summary="`共 ${toolCalls.length} 条`" label="工具调用分页" />
      </template>
      <p v-else class="technical-details-hidden">技术运行记录已隐藏，可在右下角 AI 助手的“设置”中开启。</p>

      <h3 class="block-title">阶段成果</h3>
      <div v-if="artifacts.length" class="artifact-list"><article v-for="item in pagedArtifacts" :key="item.id"><span>{{ item.sourceType }}</span><strong>{{ item.title }}</strong><small>{{ item.businessObjectType }} #{{ item.businessObjectId }}</small></article></div><div v-else class="empty-state">尚未生成指标、方案或成果工件。</div>
      <CardPager v-model:page="artifactPage" kind="records" :pages="artifactPageLabels" :summary="`共 ${artifacts.length} 项`" label="阶段成果分页" />
    </template>
  </section>
</template>

<style scoped>
.agent-workspace { padding-bottom: 1.2rem; }.run-code { padding: .24rem .45rem; background: #f3f4f6; color: #515154; font: 10px/1 ui-monospace, monospace; border: 1px solid #e1e3e6; border-radius: 7px; }.task-launch-card { margin-top: .5rem; }.section-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }.section-card-head h2 { margin: 0; }.section-card-head span { color: #6e6e73; font-size: 10px; text-align: right; }.task-mode-field { display: grid; gap: .22rem; padding: .55rem; border-radius: 10px; background: #f3f4f6; color: #515154; font-size: 11px; }.task-mode-field select { height: 34px; padding-block: 0; background: #fff; }.task-mode-field small { color: #6e6e73; font-size: 9px; line-height: 1.45; }.demand-form { display: grid; gap: .55rem; margin-top: .6rem; padding-top: .6rem; border-top: 1px solid #eceef1; }.demand-form label { display: grid; gap: .2rem; color: #515154; font-size: 11px; }.split { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }.map-input { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding: .5rem; border-radius: 9px; background: #f3f4f6; color: #6e6e73; font-size: 10px; }.map-input span { flex: 1; }.start-button { width: 100%; }.draft-card { margin-top: .5rem; padding: .6rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #f6f7f8; }.draft-card div { display: grid; gap: .1rem; }.draft-card span { color: #6e6e73; font-size: 9px; }.draft-card strong { color: #3a3a3c; font-size: 12px; }.draft-card small { color: #6e6e73; }.draft-card p { margin: .35rem 0 0; color: #515154; font-size: 11px; }.run-summary { display: grid; grid-template-columns: 1.3fr 1fr .7fr; gap: .3rem; margin-top: .55rem; }.run-summary div { display: grid; gap: .08rem; padding: .45rem; border-radius: 8px; background: #f3f4f6; }.run-summary span { color: #6e6e73; font-size: 9px; }.run-summary strong { color: #3a3a3c; font-size: 11px; }.run-progress { height: 5px; margin: .3rem 0; border-radius: 999px; background: #e5e5ea; overflow: hidden; }.run-progress i { display: block; height: 100%; background: var(--brand); transition: width .25s ease; }.run-actions { display: flex; flex-wrap: wrap; gap: .4rem; }.structured-card { margin-top: .5rem; }.structured-card h3 { margin: 0 0 .35rem; color: #3a3a3c; font-size: 12px; }.structured-card dl { display: grid; gap: .2rem; margin: 0; }.structured-card dl div { display: grid; grid-template-columns: 54px 1fr; gap: .35rem; }.structured-card dt { color: #86868b; font-size: 10px; }.structured-card dd { margin: 0; color: #515154; font-size: 10px; overflow-wrap: anywhere; }.approval-stack { display: grid; gap: .35rem; margin-top: .5rem; }.approval-stack article { padding: .6rem; border: 1px solid #ead3a7; border-radius: 10px; background: #fff8eb; }.approval-stack span { color: #956116; font-size: 9px; }.approval-stack strong { display: block; color: #3a3a3c; font-size: 12px; }.approval-stack p { margin: .2rem 0; color: #515154; font-size: 10px; }.approval-stack article div { display: flex; justify-content: flex-end; gap: .25rem; }.followup { display: grid; gap: .35rem; margin-top: .5rem; }.block-title { margin: .7rem 0 .35rem; color: #3a3a3c; font-size: 12px; }.audit-list,.artifact-list { display: grid; gap: .3rem; }.audit-list article,.artifact-list article { display: grid; gap: .08rem; padding: .45rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; }.audit-list span,.artifact-list span { color: #6e6e73; font-size: 8px; text-transform: uppercase; }.audit-list strong,.artifact-list strong { color: #3a3a3c; font: 600 10px/1.3 ui-monospace, monospace; }.audit-list small,.artifact-list small { color: #6e6e73; font-size: 9px; overflow-wrap: anywhere; }.empty-state { padding: .75rem; border: 1px dashed #cfd3d8; border-radius: 9px; color: #6e6e73; text-align: center; font-size: 10px; }.ok-text { color: #247347; font-size: 11px; }.danger { color: #b23730; }
.workflow-identity { margin-top: .55rem; overflow: hidden; border: 1px solid #dce5ef; border-radius: 12px; background: linear-gradient(145deg, #f8fbff 0%, #f3f6f9 100%); }.workflow-title { display: flex; align-items: flex-start; justify-content: space-between; gap: .6rem; padding: .65rem; border-bottom: 1px solid #e1e8ef; }.workflow-title > div { min-width: 0; }.workflow-title span { color: #60758a; font: 600 8px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }.workflow-title strong { display: block; margin-top: .08rem; color: #263746; font: 650 13px/1.25 ui-monospace, monospace; overflow-wrap: anywhere; }.workflow-title p { margin: .18rem 0 0; color: #607080; font-size: 9px; line-height: 1.45; }.workflow-source { flex: none; padding: .2rem .35rem; border-radius: 999px; background: #e5edf5; color: #385875; font-size: 8px; }.workflow-source.llm { background: #dbeeff; color: #17649c; }.workflow-source.fallback { background: #fff0d4; color: #8b5b0d; }.workflow-identity dl { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin: 0; background: #dfe7ee; }.workflow-identity dl div { min-width: 0; padding: .45rem .55rem; background: rgba(255,255,255,.8); }.workflow-identity dt { color: #7a8997; font-size: 8px; }.workflow-identity dd { margin: .08rem 0 0; color: #354655; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.workflow-fallback { display: grid; gap: .08rem; margin: 0; padding: .5rem .6rem; border-top: 1px solid #ead3a7; background: #fff8eb; color: #76521d; font-size: 9px; overflow-wrap: anywhere; }.workflow-fallback strong { color: #8b5b0d; font-size: 10px; }.workflow-map { display: grid; gap: .45rem; }.workflow-level { position: relative; display: grid; grid-template-columns: 42px minmax(0,1fr); gap: .4rem; }.workflow-level:not(:last-child)::after { content: ''; position: absolute; left: 20px; top: 34px; bottom: -.46rem; width: 1px; background: #cfdbe6; }.workflow-level > header { z-index: 1; display: grid; align-content: start; justify-items: center; gap: .1rem; padding-top: .3rem; }.workflow-level > header span { display: grid; place-items: center; width: 28px; height: 22px; border: 1px solid #b9cad9; border-radius: 6px; background: #edf4fa; color: #365c7d; font: 700 9px/1 ui-monospace, monospace; }.workflow-level > header small { color: #788a99; font-size: 7px; line-height: 1.2; text-align: center; }.workflow-lane { display: grid; grid-template-columns: repeat(auto-fit,minmax(155px,1fr)); gap: .35rem; }.workflow-node { min-width: 0; padding: .5rem; border: 1px solid #dde2e7; border-left: 3px solid #c3ccd4; border-radius: 9px; background: #fff; box-shadow: 0 2px 7px rgba(39,58,74,.04); }.workflow-node.current,.workflow-node.running { border-color: #82b5dd; border-left-color: var(--brand); box-shadow: 0 0 0 2px rgba(48,127,194,.1); }.workflow-node.completed { border-left-color: #4b9a70; }.workflow-node.waiting_approval,.workflow-node.waiting_input,.workflow-node.high,.workflow-node.critical { border-left-color: #d19739; }.workflow-node.failed { border-color: #e0aca7; border-left-color: #b23730; }.node-head { display: flex; align-items: center; justify-content: space-between; gap: .25rem; }.node-head span { color: #607080; font-size: 8px; }.node-head code { color: #87939e; font-size: 7px; overflow-wrap: anywhere; text-align: right; }.workflow-node > strong { display: block; margin-top: .15rem; color: #2f3b45; font-size: 11px; }.workflow-node > small { display: block; margin-top: .08rem; color: #78838d; font-size: 8px; }.workflow-node > p { margin: .24rem 0 0; color: #596875; font-size: 9px; line-height: 1.45; }.node-dependencies { margin-top: .28rem; color: #778693; font: 8px/1.35 ui-monospace, monospace; overflow-wrap: anywhere; }.node-dependencies span { margin-right: .25rem; color: #4c6680; font-family: inherit; font-weight: 700; }.node-tools { display: flex; flex-wrap: wrap; gap: .18rem; margin-top: .3rem; }.node-tools span { padding: .12rem .25rem; border: 1px solid #d9e1e8; border-radius: 4px; background: #f4f7f9; color: #647789; font: 7px/1.25 ui-monospace, monospace; overflow-wrap: anywhere; }.node-tools span.invoked { border-color: #b9ddca; background: #edf8f2; color: #287047; }.workflow-node details { margin-top: .3rem; border-top: 1px solid #edf0f2; padding-top: .25rem; }.workflow-node summary { cursor: pointer; color: #4d6a84; font-size: 8px; }.workflow-node pre { max-height: 180px; margin: .25rem 0 0; overflow: auto; color: #52616d; font: 7px/1.45 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }.workflow-node .node-error { color: #a4322c; }
.technical-details-hidden { margin: .65rem 0 0; padding: .5rem .55rem; border: 1px solid #e1e3e6; border-radius: 8px; background: #f6f7f8; color: #6e6e73; font-size: 9px; }
@media (prefers-reduced-motion: reduce) { .run-progress i { transition: none; } }
</style>
