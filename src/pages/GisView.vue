<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import {
  getCachedTasks,
  getSensorTypeOptions,
  reloadShellLayers,
  rerenderShellLayers,
  resetShellView,
  setShellVisibility,
  shellCounts,
  shellError,
  shellFilters,
  shellLoading,
  shellSelected,
  shellStatus,
} from '../gis/mapShell'

const { user } = useAuthStore()
const route = useRoute()
const router = useRouter()

const activeTab = ref<'sensors' | 'data' | 'tasks'>('sensors')
const sensorTypeFilter = ref('')
const selectedTaskId = ref('')

const taskOptions = computed(() => {
  return getCachedTasks().map((t) => {
    const props = (t.properties || {}) as Record<string, unknown>
    return {
      id: String(t.id ?? ''),
      label: String(props.name || props.code || ('任务 ' + String(t.id))),
      status: String(props.status || '-'),
    }
  })
})

const sensorTypeOptions = computed(() => getSensorTypeOptions())

function applyModeLayers(mode: 'sensors' | 'data' | 'tasks') {
  setShellVisibility({
    showSensors: mode === 'sensors',
    showData: mode === 'data',
    showTasks: mode === 'tasks',
  })
}

function syncFromRoute() {
  const t = route.query.tab
  if (t === 'tasks') {
    activeTab.value = 'tasks'
    applyModeLayers('tasks')
  } else if (t === 'data') {
    activeTab.value = 'data'
    applyModeLayers('data')
  } else {
    activeTab.value = 'sensors'
    applyModeLayers('sensors')
  }
  if (route.query.taskId) {
    selectedTaskId.value = String(route.query.taskId)
    shellFilters.taskId = selectedTaskId.value
  }
}

async function setMode(mode: 'sensors' | 'data' | 'tasks') {
  activeTab.value = mode
  applyModeLayers(mode)
  await router.replace({ path: '/gis', query: { ...route.query, tab: mode } })
}

async function onSelectTask(id: string) {
  selectedTaskId.value = id
  shellFilters.taskId = id
  const nextQuery: Record<string, string> = { tab: 'tasks' }
  for (const [k, v] of Object.entries(route.query)) {
    if (k === 'taskId') continue
    if (v != null && v !== '') nextQuery[k] = String(v)
  }
  if (id) nextQuery.taskId = id
  await router.replace({ path: '/gis', query: nextQuery })
  await rerenderShellLayers()
}

async function onSensorTypeChange() {
  shellFilters.sensorType = sensorTypeFilter.value
  await rerenderShellLayers()
}

function onToggle(key: 'showSensors' | 'showData' | 'showTasks', ev: Event) {
  const checked = (ev.target as HTMLInputElement).checked
  setShellVisibility({ [key]: checked })
}

async function refresh() {

  await reloadShellLayers(route.path, route.query as Record<string, unknown>)
}

onMounted(() => {
  syncFromRoute()
  void refresh()
})

watch(
  () => [route.query.tab, route.query.taskId],
  () => {
    syncFromRoute()
  },
)
</script>

<template>
  <section class="gis-page">
    <aside class="gis-side">
      <div class="gis-side-head">
        <h1>GIS 图层控制</h1>
        <p class="muted">控制全屏底图上的业务图层（传感器 / 监测数据 / 观测任务）</p>
      </div>

      <template v-if="!user">
        <p class="error">业务图层需登录。请先 <RouterLink to="/login?redirect=/gis">登录</RouterLink>。</p>
      </template>

      <div class="tabs gis-tabs">
        <button type="button" class="tab" :class="{ active: activeTab === 'sensors' }" @click="setMode('sensors')">传感器</button>
        <button type="button" class="tab" :class="{ active: activeTab === 'data' }" @click="setMode('data')">监测数据</button>
        <button type="button" class="tab" :class="{ active: activeTab === 'tasks' }" @click="setMode('tasks')">观测任务</button>
      </div>

      <div v-show="activeTab === 'sensors'" class="tab-body">
        <p class="muted">按类型筛选传感器，在地图上查看位置、状态与覆盖范围；点击要素可看详情。</p>
        <label class="check">
          <input type="checkbox" :checked="shellFilters.showSensors" @change="onToggle('showSensors', $event)" />
          显示传感器图层 <span class="badge">{{ shellCounts.sensors }}</span>
        </label>
        <label class="field">
          类型筛选
          <select v-model="sensorTypeFilter" @change="onSensorTypeChange">
            <option value="">全部类型</option>
            <option v-for="t in sensorTypeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <div class="legend">
          <div><i class="dot green" /> 传感器/平台</div>
          <div><i class="dot purple" /> 覆盖/能力</div>
        </div>
      </div>

      <div v-show="activeTab === 'data'" class="tab-body">
        <p class="muted">监测数据：点/线/面分布上图，可与数据中心查询联动。</p>
        <label class="check">
          <input type="checkbox" :checked="shellFilters.showData" @change="onToggle('showData', $event)" />
          显示监测数据 <span class="badge">{{ shellCounts.data }}</span>
        </label>
        <RouterLink class="btn ghost block" to="/data?tab=query">去数据查询</RouterLink>
        <RouterLink class="btn ghost block" to="/applications?tab=stats">去数据统计</RouterLink>
        <div class="legend">
          <div><i class="dot blue" /> 观测数据点/线/面</div>
        </div>
      </div>

      <div v-show="activeTab === 'tasks'" class="tab-body">
        <p class="muted">观测任务：目标区域、状态、关联指标/传感器上图。</p>
        <label class="check">
          <input type="checkbox" :checked="shellFilters.showTasks" @change="onToggle('showTasks', $event)" />
          显示任务图层 <span class="badge">{{ shellCounts.tasks }}</span>
        </label>
        <div class="legend">
          <div><i class="dot orange" /> 规划任务</div>
          <div><i class="dot purple" /> 任务目标</div>
        </div>
        <button class="task-item" type="button" :class="{ active: !selectedTaskId }" @click="onSelectTask('')">
          <strong>全部任务</strong>
          <span>{{ taskOptions.length }} 个</span>
        </button>
        <button
          v-for="t in taskOptions"
          :key="t.id"
          class="task-item"
          type="button"
          :class="{ active: selectedTaskId === t.id }"
          @click="onSelectTask(t.id)"
        >
          <strong>{{ t.label }}</strong>
          <span>#{{ t.id }} · {{ t.status }}</span>
        </button>
        <p v-if="!taskOptions.length" class="muted">暂无任务要素，请先在规划中心创建任务，或执行 seed_demo_storyline。</p>
        <RouterLink class="btn ghost block" to="/planning">去观测规划</RouterLink>
      </div>

      <div class="gis-actions">
        <button class="btn block" type="button" :disabled="shellLoading || !user" @click="refresh">
          {{ shellLoading ? '加载中…' : '刷新业务图层' }}
        </button>
        <button class="btn ghost block" type="button" @click="resetShellView">复位视角</button>
      </div>

      <p class="hint">{{ shellStatus }}</p>
      <p v-if="shellError" class="error">{{ shellError }}</p>

      <div v-if="shellSelected" class="pick-box">
        <h3>选中要素</h3>
        <p class="pick-name">{{ shellSelected.name }}</p>
        <pre class="pick-desc">{{ shellSelected.description || '（无属性）' }}</pre>
      </div>
    </aside>
  </section>
</template>
