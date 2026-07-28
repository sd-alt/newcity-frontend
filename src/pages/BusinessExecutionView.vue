<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as api from '../api/endpoints'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const tasks = ref<Row[]>([])
const executions = ref<Row[]>([])
const results = ref<Row[]>([])
const selectedTaskId = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const page = ref(1)
const selectedTask = computed(() => tasks.value.find((item) => String(item.id) === selectedTaskId.value))
const filteredTasks = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return tasks.value.filter((item) => !q || `${item.code} ${item.name} ${item.status}`.toLowerCase().includes(q))
})
const pagedTasks = computed(() => filteredTasks.value.slice((page.value - 1) * 8, page.value * 8))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredTasks.value.length / 8)))
function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await api.listTasks()
    tasks.value = rows(response.data)
    const firstTask = tasks.value[0]
    if (!selectedTaskId.value && firstTask) selectedTaskId.value = String(firstTask.id)
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
  } catch (cause) { error.value = errMessage(cause, '成果汇集失败') }
}
onMounted(load)
</script>

<template>
  <section class="page execution-page">
    <header class="page-head"><div><p class="eyebrow">查—选—算—评—配—优—验—执</p><h1>执行与成果</h1></div><span class="status-dot" title="执行服务状态"></span></header>
    <p class="hint">任务下发必须基于已发布方案并再次人工确认；页面区分模拟执行和真实资源回执。</p>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>
    <input v-model="keyword" type="search" placeholder="搜索任务编码、名称或状态" @input="page = 1" />
    <div v-if="pagedTasks.length" class="task-list"><button v-for="item in pagedTasks" :key="item.id" :class="{ active: String(item.id) === selectedTaskId }" @click="selectedTaskId = String(item.id); loadTaskDetail()"><span>{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.status }}</small></button></div>
    <div v-else-if="!loading" class="empty-state">尚无观测任务。</div>
    <div class="pager"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }}/{{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div>
    <template v-if="selectedTask">
      <div class="section-head"><div><p class="eyebrow">{{ selectedTask.code }}</p><h3>{{ selectedTask.name }}</h3></div><div><button class="btn tiny" @click="refreshProgress">刷新进度</button><button class="btn primary tiny" @click="advanceExecution">推进模拟执行</button><button class="btn tiny" @click="collectResults">汇集成果</button></div></div>
      <div v-if="executions.length" class="timeline"><article v-for="item in executions" :key="item.id" :class="item.status"><span></span><div><strong>{{ item.name }}</strong><small>{{ item.itemType }} · {{ item.status }} · 重试 {{ item.retryCount || 0 }} 次</small><div class="progress"><i :style="{ width: `${Number(item.progress || 0)}%` }"></i></div><p v-if="item.errorMessage" class="error">{{ item.errorMessage }}</p></div></article></div>
      <div v-else class="empty-state">尚未下发执行项。请先在方案管理中完成评价、发布确认和下发确认。</div>
      <h3 class="result-title">成果汇集</h3>
      <div v-if="results.length" class="result-list"><article v-for="item in results" :key="item.id"><span>{{ item.resultType }}</span><strong>{{ item.title }}</strong><p>{{ item.summary }}</p><small>来源：{{ item.source || '业务服务' }} · 成果 ID {{ item.id }}</small></article></div>
      <div v-else class="empty-state">任务尚未形成成果。完成执行或由成果分析 Agent 汇集后会显示在这里。</div>
    </template>
  </section>
</template>

<style scoped>
.execution-page { padding-bottom: 1rem; }.status-dot { width: 9px; height: 9px; background: #0b8a79; border-radius: 50%; box-shadow: 0 0 0 4px rgba(11,138,121,.12); }.task-list { display: grid; gap: .3rem; margin-top: .5rem; }.task-list button { display: grid; gap: .08rem; padding: .5rem; border: 1px solid #d9e3e1; border-left: 3px solid #9db4b0; background: rgba(255,255,255,.92); text-align: left; }.task-list button.active { border-left-color: #0d756b; background: #eff7f5; }.task-list span,.task-list small { color: #6b7e7a; font-size: 10px; }.task-list strong { color: #173f43; font-size: 12px; }.pager { display: flex; justify-content: center; gap: .4rem; margin: .4rem; font-size: 10px; }.pager button { border: 0; background: transparent; color: #0d756b; }.section-head { display: flex; justify-content: space-between; align-items: end; gap: .4rem; margin: .7rem 0 .4rem; }.section-head h3,.section-head p { margin: 0; }.section-head > div:last-child { display: flex; gap: .2rem; }.timeline { display: grid; gap: .35rem; }.timeline article { display: grid; grid-template-columns: 12px 1fr; gap: .35rem; }.timeline article > span { width: 8px; height: 8px; margin-top: .25rem; border: 2px solid #78918d; border-radius: 50%; }.timeline article.running > span { border-color: #b47b1c; background: #f5cf8d; }.timeline article.succeeded > span { border-color: #0c766b; background: #78c5b8; }.timeline article > div { display: grid; gap: .16rem; padding-bottom: .45rem; border-bottom: 1px solid #dce5e3; }.timeline strong { color: #173f43; font-size: 12px; }.timeline small { color: #6a7c79; }.progress { height: 4px; background: #e5ecea; overflow: hidden; }.progress i { display: block; height: 100%; background: #0d756b; }.result-title { margin: .7rem 0 .35rem; color: #173f43; font-size: 13px; }.result-list { display: grid; gap: .35rem; }.result-list article { display: grid; gap: .15rem; padding: .55rem; border: 1px solid #dbe4e2; background: #fff; }.result-list span { width: max-content; color: #8a5c16; font-size: 9px; }.result-list strong { color: #173f43; font-size: 12px; }.result-list p { margin: 0; color: #526663; font-size: 11px; }.result-list small { color: #768783; }.empty-state { padding: .9rem; border: 1px dashed #bdcbc8; color: #697c78; text-align: center; font-size: 11px; }.ok-text { color: #087066; font-size: 12px; }
</style>
