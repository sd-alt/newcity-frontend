<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const route = useRoute()
const router = useRouter()
const tab = ref('systems')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 8
const systems = ref<Row[]>([])
const nodes = ref<Row[]>([])
const elements = ref<Row[]>([])
const scenes = ref<Row[]>([])
const tasks = ref<Row[]>([])
const taskSystems = ref<Row[]>([])
const selectedSystemId = ref('')
const selectedNodeIds = ref<string[]>([])
const systemForm = ref({ code: '', name: '', sceneId: '', description: '' })
const nodeForm = ref({ level: 'indicator', code: '', name: '', parentId: '', sensingElementId: '', temporalResolution: 'PT30M', spatialResolution: '1km', observationAccuracy: '90%', monitoringFrequency: '每30分钟', coverageRequirement: '任务区域全覆盖', unit: '', description: '' })
const taskForm = ref({ name: '', sceneId: '', observationTaskId: '' })
const lastVersion = ref<Row | null>(null)

const tabs = [
  { key: 'systems', label: '指标体系' },
  { key: 'modeling', label: '手工建模' },
  { key: 'task-systems', label: '任务指标' },
  { key: 'versions', label: '版本追溯' },
]
const filteredSystems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return systems.value.filter((item) => !q || `${item.code} ${item.name} ${item.description || ''}`.toLowerCase().includes(q))
})
const pagedSystems = computed(() => filteredSystems.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredSystems.value.length / pageSize)))
const selectedSystem = computed(() => systems.value.find((item) => String(item.id) === selectedSystemId.value))
const indicatorNodes = computed(() => nodes.value.filter((item) => item.level === 'indicator'))

function syncTab() {
  const value = String(route.query.tab || 'systems')
  tab.value = tabs.some((item) => item.key === value) ? value : 'systems'
}
async function setTab(key: string) {
  await router.replace({ path: route.path, query: { tab: key } })
}
function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : []
}
async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [systemRes, elementRes, sceneRes, taskRes, observationTaskRes] = await Promise.all([
      api.listIndicatorSystems(), api.listSensingElements(), api.listScenes(), api.listTaskIndicatorSystems(), api.listTasks(),
    ])
    systems.value = asRows(systemRes.data)
    elements.value = asRows(elementRes.data)
    scenes.value = asRows(sceneRes.data)
    taskSystems.value = asRows(taskRes.data)
    tasks.value = asRows(observationTaskRes.data)
    const requestedTaskId = String(route.query.taskId || '')
    const requestedTask = tasks.value.find((item) => String(item.id) === requestedTaskId)
    if (requestedTask) {
      taskForm.value.observationTaskId = requestedTaskId
      taskForm.value.sceneId = String(requestedTask.sceneId || route.query.sceneId || '')
    }
    const firstSystem = systems.value[0]
    if (!selectedSystemId.value && firstSystem) selectedSystemId.value = String(firstSystem.id)
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '任务中心数据加载失败')
  } finally {
    loading.value = false
  }
}
async function loadNodes() {
  if (!selectedSystemId.value) {
    nodes.value = []
    return
  }
  try {
    const response = await api.listIndicatorNodes(`?systemId=${encodeURIComponent(selectedSystemId.value)}`)
    nodes.value = asRows(response.data)
  } catch (cause) {
    error.value = errMessage(cause, '指标节点加载失败')
  }
}
async function createSystem() {
  if (!systemForm.value.code.trim() || !systemForm.value.name.trim()) {
    error.value = '请填写指标体系编码和名称'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const response = await api.createIndicatorSystem({
      ...systemForm.value,
      sceneId: systemForm.value.sceneId ? Number(systemForm.value.sceneId) : null,
      systemType: 'basic', sourceType: 'manual', status: 'draft',
    })
    message.value = '指标体系已保存'
    systemForm.value = { code: '', name: '', sceneId: '', description: '' }
    await loadAll()
    selectedSystemId.value = String((response.data as Row).id)
  } catch (cause) {
    error.value = errMessage(cause, '指标体系保存失败')
  } finally {
    saving.value = false
  }
}
async function createNode() {
  if (!selectedSystemId.value || !nodeForm.value.code.trim() || !nodeForm.value.name.trim()) {
    error.value = '请选择指标体系，并填写节点编码和名称'
    return
  }
  if (nodeForm.value.level === 'indicator' && !nodeForm.value.sensingElementId) {
    error.value = '具体观测指标必须选择统一编码的感知要素'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await api.createIndicatorNode({
      ...nodeForm.value,
      systemId: Number(selectedSystemId.value),
      parentId: nodeForm.value.parentId ? Number(nodeForm.value.parentId) : null,
      sensingElementId: nodeForm.value.sensingElementId ? Number(nodeForm.value.sensingElementId) : null,
      sourceType: 'manual', applicableSceneIds: selectedSystem.value?.sceneId ? [selectedSystem.value.sceneId] : [],
    })
    message.value = '指标节点已保存'
    nodeForm.value.code = ''
    nodeForm.value.name = ''
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '指标节点保存失败')
  } finally {
    saving.value = false
  }
}
async function removeNode(item: Row) {
  if (!window.confirm(`删除指标节点“${item.name}”？已被任务引用时系统会阻止删除。`)) return
  try {
    await api.deleteIndicatorNode(item.id)
    message.value = '指标节点已删除'
    await loadNodes()
  } catch (cause) {
    error.value = errMessage(cause, '节点删除失败')
  }
}
async function createTaskSystem() {
  if (!taskForm.value.name.trim() || !taskForm.value.sceneId || selectedNodeIds.value.length === 0) {
    error.value = '请填写名称、选择场景并至少选择一个具体观测指标'
    return
  }
  saving.value = true
  try {
    await api.createTaskIndicatorSystem({
      name: taskForm.value.name,
      sceneId: Number(taskForm.value.sceneId),
      baseSystemId: selectedSystemId.value ? Number(selectedSystemId.value) : null,
      observationTaskId: taskForm.value.observationTaskId ? Number(taskForm.value.observationTaskId) : null,
      selectedNodeIds: selectedNodeIds.value.map(Number),
      requirements: { source: 'manual' }, sourceType: 'manual',
    })
    message.value = '任务指标体系草案已创建'
    taskForm.value.name = ''
    taskForm.value.observationTaskId = ''
    selectedNodeIds.value = []
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '任务指标体系创建失败')
  } finally {
    saving.value = false
  }
}
async function confirmTaskSystem(item: Row) {
  if (!window.confirm(`确认“${item.name}”作为正式任务指标体系？`)) return
  try {
    await api.confirmTaskIndicatorSystem(item.id)
    message.value = '任务指标体系已人工确认'
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '确认失败')
  }
}
async function createVersion() {
  if (!selectedSystemId.value) return
  try {
    const response = await api.createIndicatorSystemVersion(selectedSystemId.value, '手工保存版本')
    lastVersion.value = response.data as Row
    message.value = `已保存版本 v${lastVersion.value.version}`
    await loadAll()
  } catch (cause) {
    error.value = errMessage(cause, '版本保存失败')
  }
}
watch(() => route.query.tab, syncTab)
watch(selectedSystemId, loadNodes)
watch(keyword, () => { page.value = 1 })
onMounted(() => { syncTab(); loadAll() })
</script>

<template>
  <section class="page task-center">
    <header class="page-head compact-head">
      <div><p class="eyebrow">需要监测什么</p><h1>任务中心</h1></div>
      <span class="source-chip">统一感知要素编码</span>
    </header>
    <div class="tabs task-tabs">
      <button v-for="item in tabs" :key="item.key" class="tab" :class="{ active: tab === item.key }" @click="setTab(item.key)">{{ item.label }}</button>
    </div>
    <p v-if="loading" class="hint">正在加载指标体系…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok-text">{{ message }}</p>

    <template v-if="tab === 'systems'">
      <div class="panel form-stack">
        <h3>新建基础指标体系</h3>
        <input v-model="systemForm.code" placeholder="体系编码" />
        <input v-model="systemForm.name" placeholder="体系名称" />
        <select v-model="systemForm.sceneId"><option value="">通用场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select>
        <textarea v-model="systemForm.description" rows="2" placeholder="体系说明"></textarea>
        <button class="btn primary" :disabled="saving" @click="createSystem">保存指标体系</button>
      </div>
      <div class="toolbar"><input v-model="keyword" type="search" placeholder="搜索编码、名称或说明" /></div>
      <div v-if="pagedSystems.length" class="stack-list">
        <button v-for="item in pagedSystems" :key="item.id" class="record-card" :class="{ selected: String(item.id) === selectedSystemId }" @click="selectedSystemId = String(item.id)">
          <span class="record-code">{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.status }} · v{{ item.currentVersion }}</small>
        </button>
      </div>
      <div v-else-if="!loading" class="empty-state">尚无指标体系。请先创建一套基础指标体系。</div>
      <div class="pager"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }}/{{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div>
    </template>

    <template v-else-if="tab === 'modeling'">
      <div class="panel form-stack">
        <h3>按六层结构添加节点</h3>
        <select v-model="selectedSystemId"><option value="">选择指标体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select>
        <div class="split"><select v-model="nodeForm.level"><option value="object">对象</option><option value="domain">领域</option><option value="theme">主题</option><option value="subtheme">子主题</option><option value="item">指标项</option><option value="indicator">具体观测指标</option></select><select v-model="nodeForm.parentId"><option value="">无父节点</option><option v-for="item in nodes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></div>
        <div class="split"><input v-model="nodeForm.code" placeholder="节点编码" /><input v-model="nodeForm.name" placeholder="节点名称" /></div>
        <template v-if="nodeForm.level === 'indicator'">
          <select v-model="nodeForm.sensingElementId"><option value="">选择感知要素</option><option v-for="item in elements" :key="item.id" :value="String(item.id)">{{ item.name }}（{{ item.code }}）</option></select>
          <div class="split"><input v-model="nodeForm.temporalResolution" placeholder="时间分辨率" /><input v-model="nodeForm.spatialResolution" placeholder="空间分辨率" /></div>
          <div class="split"><input v-model="nodeForm.observationAccuracy" placeholder="观测精度" /><input v-model="nodeForm.monitoringFrequency" placeholder="监测频次" /></div>
          <input v-model="nodeForm.coverageRequirement" placeholder="覆盖要求" />
        </template>
        <button class="btn primary" :disabled="saving || !selectedSystemId" @click="createNode">保存节点</button>
      </div>
      <div v-if="nodes.length" class="node-table">
        <div v-for="item in nodes" :key="item.id" class="node-row">
          <div><span class="level-badge">{{ item.level }}</span><strong>{{ item.name }}</strong><small>{{ item.code }}<template v-if="item.sensingElementName"> · {{ item.sensingElementName }} · {{ item.temporalResolution }} · {{ item.spatialResolution }}</template></small></div>
          <button class="icon-danger" title="删除" @click="removeNode(item)">×</button>
        </div>
      </div>
      <div v-else class="empty-state">当前体系没有节点。先从“对象”层开始建立结构。</div>
    </template>

    <template v-else-if="tab === 'task-systems'">
      <div class="panel form-stack">
        <h3>建立任务指标体系</h3>
        <input v-model="taskForm.name" placeholder="任务指标体系名称" />
        <select v-model="taskForm.sceneId"><option value="">选择场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select>
        <select v-model="taskForm.observationTaskId"><option value="">暂不绑定任务草案</option><option v-for="item in tasks.filter((task) => !taskForm.sceneId || String(task.sceneId) === taskForm.sceneId)" :key="item.id" :value="String(item.id)">#{{ item.id }} · {{ item.name || item.code }}</option></select>
        <select v-model="selectedSystemId"><option value="">选择基础体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select>
        <div class="check-list"><label v-for="item in indicatorNodes" :key="item.id"><input v-model="selectedNodeIds" type="checkbox" :value="String(item.id)" /><span>{{ item.name }}<small>{{ item.sensingElementName }} · {{ item.temporalResolution }} · {{ item.spatialResolution }}</small></span></label></div>
        <button class="btn primary" :disabled="saving" @click="createTaskSystem">保存任务指标草案</button>
      </div>
      <div v-if="taskSystems.length" class="stack-list">
        <article v-for="item in taskSystems" :key="item.id" class="record-card static"><span class="record-code">{{ item.code }}</span><strong>{{ item.name }}</strong><small>{{ item.sourceType }} · {{ item.status }} · {{ item.selectedNodeIds?.length || 0 }} 项指标</small><button v-if="item.status === 'draft'" class="btn tiny" @click="confirmTaskSystem(item)">人工确认</button></article>
      </div>
      <div v-else class="empty-state">尚无任务指标体系草案。</div>
    </template>

    <template v-else>
      <div class="panel trace-panel">
        <p class="eyebrow">可核验快照</p><h3>{{ selectedSystem?.name || '选择指标体系' }}</h3>
        <p class="muted">版本记录保存完整节点结构、来源和业务对象 ID，用于对比与回退依据。</p>
        <select v-model="selectedSystemId"><option value="">选择指标体系</option><option v-for="item in systems" :key="item.id" :value="String(item.id)">{{ item.name }} · v{{ item.currentVersion }}</option></select>
        <button class="btn primary" :disabled="!selectedSystemId" @click="createVersion">保存当前版本</button>
      </div>
      <pre v-if="lastVersion" class="json-preview">{{ JSON.stringify(lastVersion, null, 2) }}</pre>
      <div v-else class="empty-state">保存版本后，这里会显示本次可核验快照。</div>
    </template>
  </section>
</template>

<style scoped>
.task-center { padding-bottom: 1rem; }
.compact-head { align-items: flex-start; }
.compact-head h1 { margin-bottom: 0; }
.source-chip { padding: .25rem .45rem; border: 1px solid #8bb7b1; color: #0c6158; background: #eff8f6; border-radius: 999px; font-size: 10px; }
.task-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: .25rem; }
.form-stack { display: grid; gap: .45rem; margin-top: .55rem; }
.form-stack h3 { margin: 0; font-size: 13px; color: #173f43; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }
.toolbar { margin: .55rem 0; }
.toolbar input { width: 100%; }
.stack-list { display: grid; gap: .35rem; }
.record-card { display: grid; gap: .12rem; width: 100%; padding: .55rem; text-align: left; border: 1px solid #dbe4e2; border-left: 3px solid #9fb6b2; background: #fff; border-radius: 7px; cursor: pointer; }
.record-card.selected { border-left-color: #0d756b; background: #f2f8f7; }
.record-card.static { cursor: default; }
.record-card strong { color: #173f43; font-size: 13px; }
.record-card small { color: #657875; }
.record-code { font: 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; color: #8a5c16; }
.pager { display: flex; justify-content: center; gap: .5rem; margin: .6rem 0; font-size: 11px; }
.pager button { border: 0; background: transparent; color: #0d756b; }
.node-table { display: grid; gap: .3rem; margin-top: .5rem; }
.node-row { display: flex; align-items: center; justify-content: space-between; gap: .35rem; padding: .45rem; border-bottom: 1px solid #e5ebe9; background: rgba(255,255,255,.88); }
.node-row > div { display: grid; gap: .1rem; min-width: 0; }
.node-row strong { font-size: 12px; color: #173f43; }
.node-row small { overflow: hidden; text-overflow: ellipsis; color: #6a7977; }
.level-badge { width: max-content; padding: .08rem .3rem; background: #eef3f2; color: #4b6461; font-size: 9px; border-radius: 3px; }
.icon-danger { border: 0; background: transparent; color: #a33a31; font-size: 18px; }
.check-list { max-height: 220px; overflow: auto; display: grid; gap: .3rem; padding: .35rem; border: 1px solid #dce5e3; }
.check-list label { display: flex; gap: .35rem; font-size: 12px; }
.check-list span { display: grid; }
.check-list small { color: #6a7977; }
.empty-state { margin-top: .55rem; padding: 1rem .7rem; border: 1px dashed #b9c9c6; color: #657875; text-align: center; font-size: 12px; background: rgba(247,250,249,.9); }
.trace-panel { display: grid; gap: .5rem; }
.trace-panel h3, .trace-panel p { margin: 0; }
.json-preview { max-height: 320px; overflow: auto; white-space: pre-wrap; padding: .55rem; background: #142321; color: #dcebe7; border-radius: 5px; font-size: 10px; }
.ok-text { color: #087066; font-size: 12px; }
</style>
