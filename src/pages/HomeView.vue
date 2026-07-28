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
      api.listTasks().catch(() => ({ data: [] })),
      api.listPlatforms('?pageSize=50').catch(() => ({ data: [] })),
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
    runningTasks.value = activeTasks.slice(0, 5)
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

    <div class="mission-route-head"><strong>一项监测任务怎么做</strong><small>通常从应用中心开始</small></div>
    <nav class="center-guide" aria-label="四中心使用顺序">
      <RouterLink v-for="item in centerEntries" :key="item.name" :to="item.to" class="center-entry">
        <span class="center-mark">{{ item.mark }}</span>
        <span><strong>{{ item.name }}</strong><small>{{ item.question }}</small><em>{{ item.detail }}</em></span>
      </RouterLink>
    </nav>

    <p class="hint">{{ shellLoading ? '图层加载中…' : shellStatus }}</p>
    <p v-if="mapHint" class="ok-text">{{ mapHint }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!user" class="error">业务图层需登录。请先 <RouterLink to="/login">登录</RouterLink>。</p>

    <section class="situation-readout" :class="{ warning: alertTotal > 0 }">
      <header><div><span>运行判读</span><strong>{{ alertTotal > 0 ? `${alertTotal} 项需要关注` : '当前运行平稳' }}</strong></div><small>{{ shellLoading ? '正在核对图层' : '点击下方项目联动地图' }}</small></header>
      <div>
        <button type="button" :disabled="shellLoading" @click="filterMap('sensors')"><span>传感资源</span><strong>{{ shellCounts.sensors }}</strong><small>{{ shellAlerts.offlineSensors + shellAlerts.faultSensors }} 个异常</small></button>
        <button type="button" :disabled="shellLoading" @click="filterMap('data')"><span>监测数据</span><strong>{{ shellCounts.data }}</strong><small>{{ shellAlerts.anomalousData }} 条质量异常</small></button>
        <button type="button" :disabled="shellLoading" @click="filterMap('tasks')"><span>观测任务</span><strong>{{ shellCounts.tasks }}</strong><small>{{ runningTaskTotal }} 个活跃</small></button>
      </div>
      <button v-if="alertTotal > 0" type="button" class="attention-action" :disabled="shellLoading" @click="filterMap('alerts')">在地图查看异常资源</button>
    </section>
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
.mission-route-head { display: flex; align-items: baseline; justify-content: space-between; gap: .45rem; margin: .55rem 0 .3rem; }
.mission-route-head strong { color: #173f43; font-size: 12px; }
.mission-route-head small { color: #758581; font-size: 9px; }
.center-guide { position: relative; display: grid; gap: 0.25rem; margin: 0 0 0.7rem; }
.center-guide::before { content: ''; position: absolute; left: 1.45rem; top: 1.5rem; bottom: 1.5rem; width: 1px; background: #b9cbc7; }
.center-entry { position: relative; display: grid; grid-template-columns: 2.5rem 1fr; gap: 0.55rem; padding: 0.5rem; color: #24343b; text-decoration: none; background: rgba(246, 249, 248, 0.94); border: 1px solid #d5dfdd; border-radius: 3px; }
.center-entry:hover, .center-entry:focus-visible { border-color: #287b78; box-shadow: 0 0 0 2px rgba(40, 123, 120, 0.13); outline: none; }
.center-mark { z-index: 1; display: grid; place-items: center; width: 2.35rem; min-height: 2.35rem; border: 1px solid #91b1ab; border-radius: 50%; background: #f7faf9; font: 700 0.58rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; color: #176e66; }
.center-entry strong, .center-entry small, .center-entry em { display: block; }
.center-entry strong { font-size: 0.8rem; color: #173f48; }
.center-entry small { margin-top: 0.06rem; font-size: 0.68rem; color: #287b78; }
.center-entry em { margin-top: 0.12rem; font-size: 0.62rem; font-style: normal; color: #66757a; }
.situation-readout { margin: .55rem 0; padding: .65rem; border: 1px solid #cbd8d5; border-top: 3px solid #287b78; background: #fff; }
.situation-readout.warning { border-top-color: #b47b1c; }
.situation-readout header { display: flex; align-items: flex-end; justify-content: space-between; gap: .4rem; padding-bottom: .45rem; border-bottom: 1px solid #e3e9e7; }
.situation-readout header div { display: grid; gap: .08rem; }
.situation-readout header span { color: #8a682a; font-size: 9px; }
.situation-readout header strong { color: #173f43; font-size: 14px; }
.situation-readout header small { color: #748582; font-size: 9px; text-align: right; }
.situation-readout > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: .45rem; }
.situation-readout > div button { display: grid; gap: .08rem; min-width: 0; padding: .35rem; border: 0; border-right: 1px solid #e0e8e6; background: transparent; color: #536966; text-align: left; cursor: pointer; }
.situation-readout > div button:last-child { border-right: 0; }
.situation-readout button span { font-size: 9px; }
.situation-readout button strong { color: #173f43; font-size: 18px; font-variant-numeric: tabular-nums; }
.situation-readout button small { color: #758581; font-size: 8px; }
.attention-action { width: 100%; margin-top: .45rem; padding: .35rem; border: 1px solid #d9bd8c; background: #fff8ec; color: #8d5a12; font-size: 10px; cursor: pointer; }
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
</style>
