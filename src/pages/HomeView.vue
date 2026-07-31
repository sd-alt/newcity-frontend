<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import * as api from '../api/endpoints'
import { useAuthStore } from '../stores/auth'
import { platformStatusLabel, taskStatusLabel } from '../utils/labels'
import {
  focusAlertSensors,
  focusAnomalousData,
  focusShellMode,
  shellAlerts,
  shellLoading,
  selectShellFeature,
} from '../gis/mapShell'

const { user } = useAuthStore()
const error = ref<string | null>(null)
const mapHint = ref<string | null>(null)
const runningTasks = ref<Array<Record<string, unknown>>>([])
const runningTaskTotal = ref(0)
const offlineRows = ref<Array<Record<string, unknown>>>([])

const centerEntries = [
  { name: '应用中心', question: '填写监测需求', detail: '选择手动、AI 辅助或多 Agent', to: '/application/tasks', mark: '需求' },
  { name: '任务中心', question: '配置监测指标', detail: '把需求整理成正式指标体系', to: '/tasks', mark: '指标' },
  { name: '资源中心', question: '检查可用资源', detail: '核对传感器、数据、算法与知识', to: '/resources/sensors', mark: '资源' },
  { name: '业务中心', question: '制定并执行方案', detail: '完成匹配、评估、发布与执行', to: '/business', mark: '方案' },
]

const alertTotal = computed(
  () =>
    shellAlerts.offlineSensors +
    shellAlerts.faultSensors +
    shellAlerts.failedTasks +
    shellAlerts.anomalousData,
)

function asList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (Array.isArray(o.records)) return o.records as Array<Record<string, unknown>>
    if (Array.isArray(o.features)) return o.features as Array<Record<string, unknown>>
  }
  return []
}

onMounted(async () => {
  try {
    await focusShellMode('all', '/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '底图图层加载失败'
  }
  if (!user.value) return
  try {
    const [tasks, plats] = await Promise.all([
      api.listTasks(),
      api.listPlatforms('?pageSize=50'),
    ])
    const taskRows = asList(tasks.data)
    const activeTasks = taskRows.filter((t) => {
        const st = String(t.status || '').toLowerCase()
        return (
          st.includes('run') ||
          st.includes('执行') ||
          st.includes('进行') ||
          st === 'active' ||
          st === 'draft'
        )
      })
    runningTaskTotal.value = activeTasks.length
    runningTasks.value = activeTasks.slice(0, 3)
    offlineRows.value = asList(plats.data)
      .filter((p) => {
        const st = String(p.status || '').toLowerCase()
        return (
          st.includes('offline') ||
          st.includes('离线') ||
          st.includes('fault') ||
          st.includes('故障') ||
          st.includes('维护')
        )
      })
      .slice(0, 3)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '首页业务数据加载失败'
  }
})

async function locateSensor(id: unknown) {
  await selectShellFeature('sensor', String(id), { openBubble: true, fly: true })
}
async function locateTask(id: unknown) {
  await selectShellFeature('task', String(id), { openBubble: true, fly: true })
}

async function filterMap(mode: 'sensors' | 'data' | 'tasks' | 'all' | 'alerts' | 'anomaly') {
  mapHint.value = null
  if (mode === 'alerts') {
    await focusAlertSensors()
    mapHint.value = '已切换为传感资源图层（关注离线/故障）'
    return
  }
  if (mode === 'anomaly') {
    await focusAnomalousData()
    mapHint.value = '已切换为监测数据图层（关注质量）'
    return
  }
  await focusShellMode(mode, '/')
  mapHint.value =
    mode === 'sensors'
      ? '底图仅显示传感资源'
      : mode === 'data'
        ? '底图仅显示监测数据'
        : mode === 'tasks'
          ? '底图仅显示观测任务'
          : '底图显示全部业务图层'
}
</script>

<template>
  <section class="page home-panel">
    <header class="page-head">
      <div>
        <p class="eyebrow">综合首页</p>
        <h1>综合态势</h1>
      </div>
    </header>

    <section class="quick-start">
      <div class="quick-start-primary">
        <div><strong>开始一项监测任务</strong><p>填写目标、区域和时间，后续按需配置指标与方案。</p></div>
        <RouterLink :to="centerEntries[0]!.to" class="quick-start-button">填写监测需求</RouterLink>
      </div>
      <nav aria-label="其他常用工作入口">
        <RouterLink v-for="item in centerEntries.slice(1)" :key="item.name" :to="item.to">
          {{ item.question }}<span aria-hidden="true">›</span>
        </RouterLink>
      </nav>
    </section>

    <p v-if="mapHint" class="ok-text">{{ mapHint }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!user" class="error">业务图层需登录。请先 <RouterLink to="/login">登录</RouterLink>。</p>

    <section class="situation-readout" :class="{ warning: alertTotal > 0 }">
      <header><strong>{{ alertTotal > 0 ? `${alertTotal} 项需要关注` : '当前运行平稳' }}</strong><button type="button" :disabled="shellLoading" @click="filterMap('all')">显示全部</button></header>
      <div>
        <button type="button" :disabled="shellLoading" @click="filterMap(shellAlerts.offlineSensors + shellAlerts.faultSensors > 0 ? 'alerts' : 'sensors')"><span>传感资源</span><strong>{{ shellAlerts.offlineSensors + shellAlerts.faultSensors }} 个异常</strong><small aria-hidden="true">›</small></button>
        <button type="button" :disabled="shellLoading" @click="filterMap(shellAlerts.anomalousData > 0 ? 'anomaly' : 'data')"><span>监测数据</span><strong>{{ shellAlerts.anomalousData }} 条质量异常</strong><small aria-hidden="true">›</small></button>
        <button type="button" :disabled="shellLoading" @click="filterMap('tasks')"><span>观测任务</span><strong>{{ runningTaskTotal }} 个待处理</strong><small aria-hidden="true">›</small></button>
      </div>
    </section>

    <div v-if="runningTasks.length" class="panel home-block">
      <h3>待处理任务</h3>
      <ul class="home-list">
        <li v-for="t in runningTasks" :key="'t'+t.id">
          <button type="button" class="linkish" @click="locateTask(t.id)">
            #{{ t.id }} {{ t.name || t.code || '任务' }}
          </button>
          <span class="status-badge" :class="taskStatusLabel(t.status).tone">{{ taskStatusLabel(t.status).text }}</span>
        </li>
      </ul>
    </div>

    <div v-if="offlineRows.length" class="panel home-block">
      <h3>异常资源</h3>
      <ul class="home-list">
        <li v-for="p in offlineRows" :key="'p'+p.id">
          <button type="button" class="linkish" @click="locateSensor(p.id)">
            #{{ p.id }} {{ p.name || p.code || '资源' }}
          </button>
          <span class="status-badge" :class="platformStatusLabel(p.status).tone">{{ platformStatusLabel(p.status).text }}</span>
        </li>
      </ul>
    </div>

  </section>
</template>

<style scoped>
.quick-start { margin: .35rem 0 .65rem; overflow: hidden; border: 1px solid #e1e3e6; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(29,29,31,.025), 0 8px 24px rgba(29,29,31,.035); }
.quick-start-primary { display: flex; align-items: center; justify-content: space-between; gap: .65rem; padding: .7rem; }
.quick-start-primary div { min-width: 0; }
.quick-start-primary strong { color: #3a3a3c; font-size: 13px; }
.quick-start-primary p { margin: .12rem 0 0; color: #6e6e73; font-size: 10px; line-height: 1.45; }
.quick-start-button { flex: 0 0 auto; padding: .42rem .65rem; border-radius: 8px; background: var(--brand); color: #fff; font-size: 11px; }
.quick-start nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid #e1e3e6; }
.quick-start nav a { display: flex; align-items: center; justify-content: space-between; gap: .25rem; min-width: 0; padding: .48rem .55rem; border-right: 1px solid #e1e3e6; color: #515154; font-size: 10px; }
.quick-start nav a:last-child { border-right: 0; }
.quick-start nav a:hover { background: var(--brand-soft); color: var(--brand); }
.quick-start nav span { color: #86868b; font-size: 15px; line-height: 1; }
.situation-readout { margin: .55rem 0; padding: .7rem; border: 1px solid #e1e3e6; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(29,29,31,.025), 0 8px 24px rgba(29,29,31,.035); }
.situation-readout.warning { border-color: #ead3a7; }
.situation-readout header { display: flex; align-items: center; justify-content: space-between; gap: .4rem; padding-bottom: .45rem; border-bottom: 1px solid #e1e3e6; }
.situation-readout header strong { color: #3a3a3c; font-size: 14px; }
.situation-readout header > button { padding: .2rem .35rem; border: 0; background: transparent; color: var(--brand); font-size: 9px; cursor: pointer; }
.situation-readout > div { display: grid; margin-top: .25rem; }
.situation-readout > div button { display: grid; grid-template-columns: minmax(0, 1fr) auto 12px; gap: .35rem; align-items: center; min-width: 0; padding: .38rem .15rem; border: 0; border-bottom: 1px solid #eceef1; background: transparent; color: #515154; text-align: left; cursor: pointer; }
.situation-readout > div button:last-child { border-bottom: 0; }
.situation-readout > div button:hover { color: var(--brand); }
.situation-readout button span { font-size: 10px; }
.situation-readout button strong { color: #3a3a3c; font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
.situation-readout button small { color: #86868b; font-size: 14px; line-height: 1; }
.home-block { margin: 0.5rem 0; }
.home-block h3 { margin: 0 0 0.35rem; font-size: 13px; color: #3a3a3c; }
.home-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
.home-list li { display: flex; justify-content: space-between; gap: 0.4rem; font-size: 12px; }
.linkish {
  border: 0; background: transparent; color: #1677FF; cursor: pointer; padding: 0; text-align: left; font: inherit;
}
.linkish:hover { text-decoration: underline; }
.ok-text { color: #027a48; font-size: 12px; }
</style>
