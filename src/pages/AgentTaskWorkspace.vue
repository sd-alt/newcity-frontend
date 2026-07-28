<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import { shellViewer } from '../gis/mapShell'
import { mapDrawGeometry, setMapToolMode } from '../gis/mapTools'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const router = useRouter()
const scenes = ref<Row[]>([])
const mode = ref<'manual' | 'assisted' | 'agent'>('agent')
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
let source: EventSource | null = null
let pollTimer: number | null = null

const modes = [
  { key: 'manual', label: '手动创建', note: '不调用模型，直接保存需求与任务草案' },
  { key: 'assisted', label: 'AI辅助', note: 'AI生成草案，逐阶段人工采用或调整' },
  { key: 'agent', label: '多Agent自动规划', note: 'MAF专业Agent协同，关键节点人工确认' },
] as const
const stages = computed(() => (run.value?.stages || []) as Row[])
const approvals = computed(() => ((run.value?.pendingApprovals || []) as Row[]).filter((item) => item.status === 'pending'))
const toolCalls = computed(() => (run.value?.toolCalls || []) as Row[])
const artifacts = computed(() => (run.value?.artifacts || []) as Row[])
const structured = computed(() => ((run.value as Row | null)?.demand?.structuredRequirement || {}) as Row)
const terminal = computed(() => ['completed', 'failed', 'cancelled', 'manual_required', 'paused'].includes(run.value?.status || ''))
const runId = computed(() => run.value?.id || '')
const currentStageName = computed(() => stages.value.find((item) => item.code === run.value?.currentStage)?.name || run.value?.currentStage || '未启动')

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
function localIso(value: string) { return value ? new Date(value).toISOString() : undefined }
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
      const response = await api.createAgentTask({ ...body, idempotencyKey: `web-${Date.now()}` })
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
    run.value = JSON.parse(messageEvent.data) as api.AgentRunData
    if (['completed', 'failed', 'cancelled', 'manual_required', 'waiting_approval', 'waiting_input', 'paused'].includes(run.value.status)) source?.close()
  })
  source.onerror = () => source?.close()
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
  else router.push({ path: '/business', query: { tab: 'plans' } })
}
watch(mapDrawGeometry, (geometry) => {
  if (!geometry || geometry.type !== 'polygon') return
  const rings = geometry.geojson.coordinates as number[][][]
  const ring = rings[0]
  if (ring?.length) areaWkt.value = `POLYGON ((${ring.map((point) => `${point[0]} ${point[1]}`).join(', ')}))`
})
onMounted(loadScenes)
onUnmounted(stopTracking)
</script>

<template>
  <section class="page agent-workspace">
    <header class="page-head"><div><p class="eyebrow">场景驱动任务入口</p><h1>综合感知任务</h1></div><span v-if="run" class="run-code">{{ run.id.slice(0, 8) }}</span></header>
    <div class="mode-switch"><button v-for="item in modes" :key="item.key" :class="{ active: mode === item.key }" @click="mode = item.key"><strong>{{ item.label }}</strong><small>{{ item.note }}</small></button></div>
    <div class="panel demand-form">
      <label>场景<select v-model="sceneId"><option value="">选择场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select></label>
      <label>监测需求<textarea v-model="requirement" rows="5" placeholder="描述对象、区域、时间、目标、约束和成果要求"></textarea></label>
      <div class="split"><label>开始时间<input v-model="timeStart" type="datetime-local" /></label><label>结束时间<input v-model="timeEnd" type="datetime-local" /></label></div>
      <label>更新频次<input v-model="updateFrequency" placeholder="例如 PT30M" /></label>
      <div class="map-input"><span>{{ areaWkt ? '已绘制任务区域' : '可在地图选点、框选或绘制多边形' }}</span><button class="btn tiny" @click="drawArea">绘制区域</button><button v-if="areaWkt" class="btn ghost tiny" @click="clearArea">清除</button></div>
      <button class="btn primary start-button" :disabled="submitting" @click="submitDemand">{{ submitting ? '正在创建任务草案…' : mode === 'manual' ? '创建手动任务草案' : mode === 'assisted' ? '生成 AI 辅助草案' : '启动多Agent自动规划' }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>

    <article v-if="draft" class="draft-card"><div><span>任务草案</span><strong>#{{ draft.taskId }} · 需求 #{{ draft.demandId }}</strong><small>{{ draft.mode }} · {{ draft.status }}</small></div><p>{{ draft.originalRequirement }}</p><button v-if="draft.mode === 'manual'" class="btn tiny" @click="router.push({ path: '/tasks', query: { tab: 'task-systems', taskId: draft.taskId, sceneId } })">继续配置任务指标</button></article>

    <template v-if="run">
      <div class="run-summary"><div><span>当前阶段</span><strong>{{ currentStageName }}</strong></div><div><span>运行状态</span><strong>{{ run.status }}</strong></div><div><span>总体进度</span><strong>{{ Number(run.progress || 0).toFixed(0) }}%</strong></div></div>
      <div class="run-progress"><i :style="{ width: `${Number(run.progress || 0)}%` }"></i></div>
      <div class="run-actions"><button class="btn tiny" :disabled="run.status !== 'running' && run.status !== 'queued'" @click="control('pause')">暂停</button><button class="btn tiny" :disabled="run.status !== 'paused' && run.status !== 'manual_required'" @click="control('resume')">恢复</button><button class="btn tiny" :disabled="run.status !== 'failed' && run.status !== 'manual_required'" @click="control('retry')">重试</button><button class="btn ghost tiny" @click="control('takeover')">人工接管</button><button class="btn ghost tiny" @click="refreshRun()">刷新</button><button class="btn danger tiny" @click="control('cancel')">取消</button></div>

      <div v-if="Object.keys(structured).length" class="panel structured-card"><h3>已识别需求</h3><dl><div><dt>对象</dt><dd>{{ structured.object || '-' }}</dd></div><div><dt>区域</dt><dd>{{ structured.area || '-' }}</dd></div><div><dt>时间</dt><dd>{{ structured.timeRange?.start || '-' }} → {{ structured.timeRange?.end || '-' }}</dd></div><div><dt>频次</dt><dd>{{ structured.updateFrequency || '-' }}</dd></div><div><dt>感知要素</dt><dd>{{ (structured.sensingElementCodes || []).join('、') || '-' }}</dd></div></dl></div>

      <div v-if="approvals.length" class="approval-stack"><article v-for="item in approvals" :key="item.id"><span>待人工确认</span><strong>{{ item.title }}</strong><p>{{ item.description }}</p><div><button class="btn ghost tiny" @click="openAdjustment(item)">先人工调整</button><button class="btn danger tiny" @click="decide(item, 'rejected')">拒绝</button><button class="btn primary tiny" @click="decide(item, 'approved')">确认并继续</button></div></article></div>
      <div v-if="run.status === 'waiting_input'" class="panel followup"><strong>补充需求信息</strong><textarea v-model="followup" rows="3" placeholder="补充缺失的区域、时间、目标或约束"></textarea><button class="btn primary" @click="sendFollowup">提交并重新分析</button></div>

      <h3 class="block-title">任务进程</h3>
      <div class="stage-track"><article v-for="item in stages" :key="item.id" :class="[item.status, { current: item.code === run.currentStage }]" :title="item.errorMessage || item.agentName"><span></span><div><strong>{{ item.name }}</strong><small>{{ item.agentName }} · {{ item.status }}</small><p v-if="item.errorMessage">{{ item.errorMessage }}</p></div></article></div>

      <h3 class="block-title">工具调用与数据来源</h3>
      <div v-if="toolCalls.length" class="audit-list"><article v-for="item in toolCalls.slice().reverse().slice(0, 12)" :key="item.id"><span>{{ item.status }}</span><strong>{{ item.toolName }}</strong><small>{{ item.source || '业务 Service' }} · {{ item.durationMs }}ms · 对象 {{ JSON.stringify(item.objectIds || {}) }}</small></article></div><div v-else class="empty-state">尚无工具调用记录。后台 Worker 开始处理后会实时显示。</div>

      <h3 class="block-title">阶段成果</h3>
      <div v-if="artifacts.length" class="artifact-list"><article v-for="item in artifacts" :key="item.id"><span>{{ item.sourceType }}</span><strong>{{ item.title }}</strong><small>{{ item.businessObjectType }} #{{ item.businessObjectId }}</small></article></div><div v-else class="empty-state">尚未生成指标、方案或成果工件。</div>
    </template>
  </section>
</template>

<style scoped>
.agent-workspace { padding-bottom: 1.2rem; }.run-code { padding: .22rem .4rem; background: #152c2a; color: #cfe7e2; font: 10px/1 ui-monospace, monospace; border-radius: 3px; }.mode-switch { display: grid; gap: .3rem; }.mode-switch button { display: grid; gap: .1rem; padding: .5rem; border: 1px solid #d7e1df; border-left: 3px solid #9eb3af; background: rgba(255,255,255,.92); text-align: left; }.mode-switch button.active { border-left-color: #0c766b; background: #eef7f5; }.mode-switch strong { color: #173f43; font-size: 12px; }.mode-switch small { color: #6a7d79; font-size: 9px; }.demand-form { display: grid; gap: .45rem; margin-top: .55rem; }.demand-form label { display: grid; gap: .18rem; color: #546a66; font-size: 11px; }.split { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }.map-input { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; padding: .4rem; background: #f0f5f3; color: #60736f; font-size: 10px; }.map-input span { flex: 1; }.start-button { width: 100%; }.draft-card { margin-top: .5rem; padding: .55rem; border-left: 4px solid #b27a21; background: #fffbf1; }.draft-card div { display: grid; gap: .1rem; }.draft-card span { color: #9b6718; font-size: 9px; }.draft-card strong { color: #513a18; font-size: 12px; }.draft-card small { color: #7f6b4b; }.draft-card p { margin: .35rem 0 0; color: #5d5547; font-size: 11px; }.run-summary { display: grid; grid-template-columns: 1.3fr 1fr .7fr; gap: .25rem; margin-top: .55rem; }.run-summary div { display: grid; gap: .08rem; padding: .4rem; background: #edf4f2; }.run-summary span { color: #6d7e7b; font-size: 9px; }.run-summary strong { color: #183f43; font-size: 11px; }.run-progress { height: 5px; margin: .25rem 0; background: #dce7e4; overflow: hidden; }.run-progress i { display: block; height: 100%; background: #0c766b; transition: width .25s ease; }.run-actions { display: flex; flex-wrap: wrap; gap: .22rem; }.structured-card { margin-top: .5rem; }.structured-card h3 { margin: 0 0 .35rem; color: #173f43; font-size: 12px; }.structured-card dl { display: grid; gap: .2rem; margin: 0; }.structured-card dl div { display: grid; grid-template-columns: 54px 1fr; gap: .35rem; }.structured-card dt { color: #7a8986; font-size: 10px; }.structured-card dd { margin: 0; color: #425b57; font-size: 10px; overflow-wrap: anywhere; }.approval-stack { display: grid; gap: .35rem; margin-top: .5rem; }.approval-stack article { padding: .55rem; border: 1px solid #d8ae65; background: #fff8ea; }.approval-stack span { color: #a36b12; font-size: 9px; }.approval-stack strong { display: block; color: #59411d; font-size: 12px; }.approval-stack p { margin: .2rem 0; color: #756444; font-size: 10px; }.approval-stack article div { display: flex; justify-content: flex-end; gap: .25rem; }.followup { display: grid; gap: .35rem; margin-top: .5rem; }.block-title { margin: .7rem 0 .35rem; color: #173f43; font-size: 12px; }.stage-track { position: relative; display: grid; gap: 0; }.stage-track::before { content: ''; position: absolute; left: 5px; top: 8px; bottom: 8px; width: 1px; background: #b8c9c5; }.stage-track article { position: relative; display: grid; grid-template-columns: 12px 1fr; gap: .35rem; min-height: 34px; }.stage-track article > span { z-index: 1; width: 9px; height: 9px; margin-top: 4px; border: 2px solid #9db1ad; border-radius: 50%; background: #f7faf9; }.stage-track article.completed > span { border-color: #0d766b; background: #72c1b4; }.stage-track article.running > span,.stage-track article.current > span { border-color: #b47718; background: #f0c474; }.stage-track article.failed > span,.stage-track article.manual_required > span { border-color: #a84036; background: #e6a39c; }.stage-track article > div { display: grid; padding-bottom: .35rem; }.stage-track strong { color: #294a46; font-size: 11px; }.stage-track small { color: #71827f; font-size: 9px; }.stage-track p { margin: .12rem 0; color: #a33a31; font-size: 9px; }.audit-list,.artifact-list { display: grid; gap: .25rem; }.audit-list article,.artifact-list article { display: grid; gap: .08rem; padding: .4rem; border-left: 2px solid #7ea29d; background: rgba(255,255,255,.9); }.audit-list span,.artifact-list span { color: #8c641f; font-size: 8px; text-transform: uppercase; }.audit-list strong,.artifact-list strong { color: #284b47; font: 600 10px/1.3 ui-monospace, monospace; }.audit-list small,.artifact-list small { color: #71817e; font-size: 9px; overflow-wrap: anywhere; }.empty-state { padding: .75rem; border: 1px dashed #bdcbc8; color: #697c78; text-align: center; font-size: 10px; }.ok-text { color: #087066; font-size: 11px; }.danger { color: #a33a31; }
@media (prefers-reduced-motion: reduce) { .run-progress i { transition: none; } }
</style>
