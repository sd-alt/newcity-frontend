<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const route = useRoute()
const router = useRouter()
const tasks = ref<Row[]>([])
const executions = ref<Row[]>([])
const results = ref<Row[]>([])
const selectedTaskId = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const page = ref(1)
const viewPage = ref(1)
const executionPage = ref(1)
const resultPage = ref(1)
const pageSize = 4
const viewPages = ['选择观测任务', '查看执行进度', '查看任务成果']
const selectedTask = computed(() => tasks.value.find((item) => String(item.id) === selectedTaskId.value))
const selectedPlanId = computed(() => typeof route.query.planId === 'string' ? route.query.planId : '')
const selectedRunId = computed(() => typeof route.query.runId === 'string' ? route.query.runId : '')
const filteredTasks = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return tasks.value.filter((item) => !q || `${item.code} ${item.name} ${item.status}`.toLowerCase().includes(q))
})
const pagedTasks = computed(() => filteredTasks.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredTasks.value.length / pageSize)))
const taskPageLabels = computed(() => Array.from({ length: pageCount.value }, (_, index) => `观测任务第 ${index + 1} 页`))
const executionPageCount = computed(() => Math.max(1, Math.ceil(executions.value.length / pageSize)))
const pagedExecutions = computed(() => executions.value.slice((executionPage.value - 1) * pageSize, executionPage.value * pageSize))
const executionPageLabels = computed(() => Array.from({ length: executionPageCount.value }, (_, index) => `执行进度第 ${index + 1} 页`))
const resultPageCount = computed(() => Math.max(1, Math.ceil(results.value.length / pageSize)))
const pagedResults = computed(() => results.value.slice((resultPage.value - 1) * pageSize, resultPage.value * pageSize))
const resultPageLabels = computed(() => Array.from({ length: resultPageCount.value }, (_, index) => `任务成果第 ${index + 1} 页`))
function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await api.listTasks()
    tasks.value = rows(response.data)
    const requestedTaskId = typeof route.query.taskId === 'string' ? route.query.taskId : ''
    const initialTask = tasks.value.find((item) => String(item.id) === requestedTaskId) || tasks.value[0]
    if (!selectedTaskId.value && initialTask) selectedTaskId.value = String(initialTask.id)
    await loadTaskDetail()
  } catch (cause) { error.value = errMessage(cause, '执行任务加载失败') }
  finally { loading.value = false }
}
async function loadTaskDetail() {
  if (!selectedTaskId.value) { executions.value = []; results.value = []; return }
  try {
    const [executionRes, resultRes] = await Promise.all([api.listExecutionItems(`?taskId=${selectedTaskId.value}`), api.listTaskResults(`?taskId=${selectedTaskId.value}`)])
    executions.value = rows(executionRes.data); results.value = rows(resultRes.data)
  } catch (cause) { error.value = errMessage(cause, '执行详情加载失败') }
}
async function selectTask(item: Row) {
  selectedTaskId.value = String(item.id)
  await router.replace({ query: { ...route.query, taskId: selectedTaskId.value } })
  executionPage.value = 1
  resultPage.value = 1
  await loadTaskDetail()
  viewPage.value = 2
}
async function advanceExecution() {
  if (!selectedTaskId.value) return
  try {
    await api.runBusinessAction('tasks', selectedTaskId.value, 'execute')
    message.value = '已执行一个模拟进度检查点；真实资源仍需外部接口回执'
    await loadTaskDetail()
  } catch (cause) { error.value = errMessage(cause, '执行推进失败') }
}
async function refreshProgress() {
  if (!selectedTaskId.value) return
  try {
    const response = await api.runBusinessAction('tasks', selectedTaskId.value, 'progress')
    const data = response.data as Row
    executions.value = rows(data.items)
    message.value = `任务总体进度 ${data.progress ?? 0}%`
  } catch (cause) { error.value = errMessage(cause, '进度刷新失败') }
}
async function collectResults() {
  if (!selectedTaskId.value) return
  try {
    await api.runBusinessAction('tasks', selectedTaskId.value, 'collect-results')
    message.value = '任务成果已汇集并建立追溯记录'
    await loadTaskDetail()
    viewPage.value = 3
  } catch (cause) { error.value = errMessage(cause, '成果汇集失败') }
}
onMounted(load)
</script>

<template>
  <section class="page execution-page">
    <header class="page-head"><div><p class="eyebrow">06 · 过程管理与成果追溯</p><h1>执行监控、过程追踪与成果查看</h1></div></header>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>
    <section v-if="selectedTask" class="task-context-card" aria-label="当前业务任务上下文">
      <div><small>任务名称</small><strong>{{ selectedTask.name }}</strong></div>
      <div><small>任务状态</small><strong>{{ selectedTask.status || '-' }}</strong></div>
      <div><small>当前阶段</small><strong>06 过程追溯</strong></div>
      <div><small>当前方案</small><strong>{{ selectedPlanId ? `#${selectedPlanId}` : '未指定' }}</strong></div>
      <div><small>运行状态</small><strong>{{ selectedRunId ? `运行 #${selectedRunId}` : '无 Agent 运行上下文' }}</strong></div>
      <nav><RouterLink class="btn ghost tiny" :to="{ path: '/business', query: { tab: 'tasks', taskId: selectedTaskId } }">返回任务入口</RouterLink><RouterLink class="btn ghost tiny" :to="{ path: '/application', query: { tab: 'gis', taskId: selectedTaskId } }">地图定位</RouterLink></nav>
    </section>
    <section v-if="viewPage === 1" class="panel execution-list-card">
      <header class="section-card-head"><h2>观测任务</h2><span>共 {{ filteredTasks.length }} 项</span></header>
      <p class="muted">任务下发必须基于已发布方案并再次人工确认；页面区分模拟执行和真实资源回执。</p>
      <input v-model="keyword" type="search" placeholder="搜索任务编码、名称或状态" @input="page = 1" />
      <div v-if="pagedTasks.length" class="task-list"><button v-for="item in pagedTasks" :key="item.id" :class="{ active: String(item.id) === selectedTaskId }" @click="selectTask(item)"><span>{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.status }}</small></button></div>
      <div v-else-if="!loading" class="empty-state">尚无观测任务。</div>
      <CardPager v-model:page="page" kind="records" :pages="taskPageLabels" :summary="`共 ${filteredTasks.length} 项`" label="观测任务分页" />
    </section>
    <section v-else-if="viewPage === 2 && selectedTask" class="panel execution-detail-card">
      <div class="section-head"><div><p class="eyebrow">{{ selectedTask.code }}</p><h3>{{ selectedTask.name }}</h3></div><div><button class="btn tiny" @click="refreshProgress">刷新进度</button><button class="btn primary tiny" @click="advanceExecution">推进模拟执行</button></div></div>
      <div v-if="executions.length" class="timeline"><article v-for="item in pagedExecutions" :key="item.id" :class="item.status"><span></span><div><strong>{{ item.name }}</strong><small>{{ item.itemType }} · {{ item.status }} · 重试 {{ item.retryCount || 0 }} 次</small><div class="progress"><i :style="{ width: `${Number(item.progress || 0)}%` }"></i></div><p v-if="item.errorMessage" class="error">{{ item.errorMessage }}</p></div></article></div>
      <div v-else class="empty-state">尚未下发执行项。请先在方案管理中完成评价、发布确认和下发确认。</div>
      <CardPager v-model:page="executionPage" kind="records" :pages="executionPageLabels" :summary="`共 ${executions.length} 项`" label="执行进度分页" />
    </section>
    <section v-else-if="viewPage === 3 && selectedTask" class="panel execution-detail-card">
      <div class="section-head"><div><p class="eyebrow">{{ selectedTask.code }}</p><h3>{{ selectedTask.name }}</h3></div><button class="btn primary tiny" @click="collectResults">汇集成果</button></div>
      <div v-if="results.length" class="result-list"><article v-for="item in pagedResults" :key="item.id"><span>{{ item.resultType }}</span><strong>{{ item.title }}</strong><p>{{ item.summary }}</p><small>来源：{{ item.source || '业务服务' }} · 成果 ID {{ item.id }}</small></article></div>
      <div v-else class="empty-state">任务尚未形成成果。完成执行或由成果分析 Agent 汇集后会显示在这里。</div>
      <CardPager v-model:page="resultPage" kind="records" :pages="resultPageLabels" :summary="`共 ${results.length} 项`" label="任务成果分页" />
    </section>
    <CardPager v-model:page="viewPage" :pages="viewPages" label="执行与成果内容分页" />
  </section>
</template>

<style scoped>
.task-context-card { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .4rem; margin: .55rem 0; padding: .6rem; border: 1px solid #e1e3e6; border-radius: 12px; background: #fff; }
.task-context-card > div { display: grid; gap: .12rem; min-width: 0; }
.task-context-card small { color: #6e6e73; font-size: 9px; }
.task-context-card strong { overflow-wrap: anywhere; color: #29292d; font-size: 11px; }
.task-context-card nav { grid-column: 1 / -1; display: flex; gap: .35rem; flex-wrap: wrap; padding-top: .35rem; border-top: 1px solid #ededf0; }
@media (max-width: 760px) { .task-context-card { grid-template-columns: 1fr 1fr; } }
.execution-page { padding-bottom: 1rem; }.execution-list-card,.execution-detail-card { margin-top: .6rem; }.section-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .4rem; }.section-card-head h2 { margin: 0; }.section-card-head span { color: #6e6e73; font-size: 10px; white-space: nowrap; }.task-list { display: grid; gap: .4rem; margin-top: .5rem; padding: .42rem; border-radius: 12px; background: #f3f4f6; }.task-list button { display: grid; gap: .1rem; padding: .55rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; text-align: left; cursor: pointer; }.task-list button.active { border-color: #b7d7f7; background: var(--brand-soft); }.task-list span,.task-list small { color: #6e6e73; font-size: 10px; }.task-list strong { color: #3a3a3c; font-size: 12px; }.pager { display: flex; justify-content: center; gap: .4rem; margin: .5rem 0 0; font-size: 10px; }.pager button { border: 0; background: transparent; color: var(--brand); }.section-head { display: flex; justify-content: space-between; align-items: end; gap: .5rem; margin: 0 0 .55rem; }.section-head h3,.section-head p { margin: 0; }.section-head > div:last-child { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .3rem; }.timeline { display: grid; gap: .35rem; padding: .5rem; border-radius: 12px; background: #f3f4f6; }.timeline article { display: grid; grid-template-columns: 12px 1fr; gap: .35rem; }.timeline article > span { width: 8px; height: 8px; margin-top: .25rem; border: 2px solid #c7c7cc; border-radius: 50%; background: #fff; }.timeline article.running > span { border-color: var(--brand); background: #68a9ea; }.timeline article.succeeded > span { border-color: #2f8f5b; background: #78c59b; }.timeline article > div { display: grid; gap: .16rem; padding-bottom: .45rem; border-bottom: 1px solid #e1e3e6; }.timeline strong { color: #3a3a3c; font-size: 12px; }.timeline small { color: #6e6e73; }.progress { height: 4px; background: #e5e5ea; overflow: hidden; }.progress i { display: block; height: 100%; background: var(--brand); }.result-title { margin: .75rem 0 .4rem; padding-top: .7rem; border-top: 1px solid #eceef1; color: #3a3a3c; font-size: 13px; }.result-list { display: grid; gap: .4rem; padding: .42rem; border-radius: 12px; background: #f3f4f6; }.result-list article { display: grid; gap: .15rem; padding: .55rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; }.result-list span { width: max-content; color: #515154; font-size: 9px; }.result-list strong { color: #3a3a3c; font-size: 12px; }.result-list p { margin: 0; color: #515154; font-size: 11px; }.result-list small { color: #6e6e73; }.empty-state { padding: .9rem; border: 1px dashed #cfd3d8; color: #6e6e73; text-align: center; font-size: 11px; }.ok-text { color: #247347; font-size: 12px; }
</style>
