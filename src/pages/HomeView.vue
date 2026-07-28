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
  shellCounts,
  shellLoading,
  shellStatus,
  selectShellFeature,
} from '../gis/mapShell'

const { user } = useAuthStore()
const error = ref<string | null>(null)
const mapHint = ref<string | null>(null)
const runningTasks = ref<Array<Record<string, unknown>>>([])
const offlineRows = ref<Array<Record<string, unknown>>>([])

const centerEntries = [
  { name: '任务中心', question: '需要监测什么', detail: '指标建模、指标体系与版本追溯', to: '/tasks', mark: '01' },
  { name: '资源中心', question: '可以使用什么', detail: '传感器、观测数据、算法与知识', to: '/resources/sensors', mark: '02' },
  { name: '业务中心', question: '如何完成监测', detail: '任务、资源匹配、方案、执行与成果', to: '/business', mark: '03' },
  { name: '应用中心', question: '如何发起和跟踪', detail: '场景需求、Agent 进程与综合态势', to: '/application/tasks', mark: '04' },
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
      api.listTasks().catch(() => ({ data: [] })),
      api.listPlatforms('?pageSize=50').catch(() => ({ data: [] })),
    ])
    const taskRows = asList(tasks.data)
    runningTasks.value = taskRows
      .filter((t) => {
        const st = String(t.status || '').toLowerCase()
        return (
          st.includes('run') ||
          st.includes('执行') ||
          st.includes('进行') ||
          st === 'active' ||
          st === 'draft'
        )
      })
      .slice(0, 5)
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
      .slice(0, 5)
  } catch {
    /* ignore list failures */
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

    <nav class="center-guide" aria-label="四中心业务入口">
      <RouterLink v-for="item in centerEntries" :key="item.name" :to="item.to" class="center-entry">
        <span class="center-mark">{{ item.mark }}</span>
        <span><strong>{{ item.name }}</strong><small>{{ item.question }}</small><em>{{ item.detail }}</em></span>
      </RouterLink>
    </nav>

    <p class="hint">{{ shellLoading ? '图层加载中…' : shellStatus }}</p>
    <p v-if="mapHint" class="ok-text">{{ mapHint }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!user" class="error">业务图层需登录。请先 <RouterLink to="/login">登录</RouterLink>。</p>

    <div class="cards compact home-stats">
      <button type="button" class="card stat clickable" :disabled="shellLoading" @click="filterMap('sensors')">
        <h3>传感资源</h3>
        <p class="stat-num">{{ shellCounts.sensors }}</p>
        <p class="muted tiny">点击仅显示</p>
      </button>
      <button type="button" class="card stat clickable" :disabled="shellLoading" @click="filterMap('data')">
        <h3>监测数据</h3>
        <p class="stat-num">{{ shellCounts.data }}</p>
        <p class="muted tiny">点击仅显示</p>
      </button>
      <button type="button" class="card stat clickable" :disabled="shellLoading" @click="filterMap('tasks')">
        <h3>观测任务</h3>
        <p class="stat-num">{{ shellCounts.tasks }}</p>
        <p class="muted tiny">点击仅显示</p>
      </button>
      <button type="button" class="card stat warn clickable" :disabled="shellLoading" @click="filterMap('alerts')">
        <h3>当前告警</h3>
        <p class="stat-num">{{ alertTotal }}</p>
        <p class="muted tiny">
          离线 {{ shellAlerts.offlineSensors }} · 故障/维护 {{ shellAlerts.faultSensors }} · 异常数据
          {{ shellAlerts.anomalousData }}
        </p>
      </button>
    </div>
    <div class="home-map-actions">
      <button type="button" class="btn ghost tiny" :disabled="shellLoading" @click="filterMap('all')">显示全部图层</button>
      <button type="button" class="btn ghost tiny" :disabled="shellLoading" @click="filterMap('anomaly')">数据质量关注</button>
    </div>

    <div v-if="runningTasks.length" class="panel home-block">
      <h3>执行中 / 活跃任务</h3>
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
      <h3>异常 / 离线资源</h3>
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
.home-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin: 0.6rem 0; }
.center-guide { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; margin: 0.65rem 0 0.8rem; }
.center-entry { display: grid; grid-template-columns: 2.2rem 1fr; gap: 0.55rem; padding: 0.65rem; color: #24343b; text-decoration: none; background: rgba(246, 249, 248, 0.94); border: 1px solid #cbd8d5; border-left: 3px solid #287b78; border-radius: 4px; }
.center-entry:hover, .center-entry:focus-visible { border-color: #287b78; box-shadow: 0 0 0 2px rgba(40, 123, 120, 0.13); outline: none; }
.center-mark { font: 700 0.72rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; color: #a76420; border-right: 1px solid #cbd8d5; }
.center-entry strong, .center-entry small, .center-entry em { display: block; }
.center-entry strong { font-size: 0.84rem; color: #173f48; }
.center-entry small { margin-top: 0.12rem; font-size: 0.72rem; color: #287b78; }
.center-entry em { margin-top: 0.2rem; font-size: 0.66rem; font-style: normal; color: #66757a; }
.home-stats .card.stat { padding: 0.5rem 0.55rem; text-align: left; width: 100%; border: 1px solid #E5E7EB; background: #fff; border-radius: 10px; cursor: pointer; }
.home-stats .card.stat.clickable:hover { border-color: #1677FF; box-shadow: 0 0 0 2px rgba(22,119,255,0.12); }
.home-stats .card.stat:disabled { opacity: 0.6; cursor: not-allowed; }
.home-stats .warn .stat-num { color: #F59E0B; }
.home-stats h3 { margin: 0; font-size: 12px; color: #6B7280; font-weight: 600; }
.home-stats .stat-num { margin: 0.15rem 0; font-size: 1.35rem; font-weight: 700; color: #0F3D66; }
.home-stats .tiny { font-size: 11px; margin: 0; }
.home-map-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.55rem; }
.home-block { margin: 0.5rem 0; }
.home-block h3 { margin: 0 0 0.35rem; font-size: 13px; color: #0F3D66; }
.home-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
.home-list li { display: flex; justify-content: space-between; gap: 0.4rem; font-size: 12px; }
.linkish {
  border: 0; background: transparent; color: #1677FF; cursor: pointer; padding: 0; text-align: left; font: inherit;
}
.linkish:hover { text-decoration: underline; }
.ok-text { color: #027a48; font-size: 12px; }
@media (max-width: 720px) { .center-guide { grid-template-columns: 1fr; } }
</style>
