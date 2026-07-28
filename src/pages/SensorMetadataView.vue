<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as api from '../api/endpoints'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const sensors = ref<Row[]>([])
const selectedId = ref('')
const detail = ref<Row | null>(null)
const tab = ref('general')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const draft = ref<Row>({})
const historyDraft = ref({ eventType: 'maintenance', occurredAt: '', description: '' })
const jsonDraft = ref('{}')

const tabs: Array<[string, string]> = [
  ['general', '通用信息'], ['attributes', '属性信息'], ['spatiotemporal', '时空参考'], ['geographic', '地理定位'],
  ['history', '历史信息'], ['contact', '联系信息'], ['constraints', '约束信息'], ['interfaces', '接口信息'],
]
const filteredSensors = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return sensors.value.filter((item) => !q || `${item.sensorName || item.name || ''} ${item.platformName || ''}`.toLowerCase().includes(q))
})

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value ?? {})) }
function syncDraft() {
  if (!detail.value) return
  draft.value = clone(detail.value[tab.value] || {})
  if (tab.value === 'attributes') draft.value.measurementItems = clone(detail.value.measurementItems || [])
  if (tab.value === 'constraints' || tab.value === 'interfaces') jsonDraft.value = JSON.stringify(detail.value[tab.value] || (tab.value === 'interfaces' ? [] : {}), null, 2)
}
async function loadSensors() {
  loading.value = true
  error.value = ''
  try {
    const response = await api.listSensors('?pageSize=200')
    sensors.value = rows(response.data)
    const firstSensor = sensors.value[0]
    if (!selectedId.value && firstSensor) selectedId.value = String(firstSensor.id)
    await loadDetail()
  } catch (cause) {
    error.value = errMessage(cause, '传感器列表加载失败')
  } finally { loading.value = false }
}
async function loadDetail() {
  if (!selectedId.value) { detail.value = null; return }
  loading.value = true
  try {
    const response = await api.getSensorOctuple(selectedId.value)
    detail.value = response.data as Row
    syncDraft()
  } catch (cause) {
    error.value = errMessage(cause, '八元组元数据加载失败')
  } finally { loading.value = false }
}
function selectTab(key: string) { tab.value = key; syncDraft() }
async function saveCurrent() {
  if (!selectedId.value) return
  saving.value = true
  error.value = ''
  try {
    let payload: Row
    if (tab.value === 'geographic') payload = { spatiotemporal: draft.value }
    else if (tab.value === 'history') {
      if (!historyDraft.value.occurredAt) throw new Error('请选择历史事件发生时间')
      payload = { history: [{ ...historyDraft.value, occurredAt: new Date(historyDraft.value.occurredAt).toISOString() }] }
    } else if (tab.value === 'constraints' || tab.value === 'interfaces') {
      const parsed = JSON.parse(jsonDraft.value)
      payload = { [tab.value]: parsed }
    } else payload = { [tab.value]: draft.value }
    await api.updateSensorOctuple(selectedId.value, payload)
    message.value = `${tabs.find((item) => item[0] === tab.value)?.[1]}已保存`
    await loadDetail()
  } catch (cause) {
    error.value = errMessage(cause, '元数据保存失败')
  } finally { saving.value = false }
}
onMounted(loadSensors)
</script>

<template>
  <section class="page metadata-page">
    <header class="page-head"><div><p class="eyebrow">SensorML 兼容组织</p><h1>传感器八元组</h1></div><span class="octuple-mark">8</span></header>
    <p class="hint">八类信息属于同一传感器详情，不拆成独立菜单。</p>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>
    <input v-model="keyword" type="search" placeholder="搜索传感器或平台" />
    <select v-model="selectedId" class="sensor-select" @change="loadDetail"><option value="">选择传感器</option><option v-for="item in filteredSensors" :key="item.id" :value="String(item.id)">{{ item.sensorName || item.name || `传感器 #${item.id}` }} · {{ item.platformName || '' }}</option></select>
    <div class="octuple-tabs" role="tablist"><button v-for="item in tabs" :key="item[0]" :class="{ active: tab === item[0] }" @click="selectTab(item[0])"><span>{{ tabs.findIndex((t) => t[0] === item[0]) + 1 }}</span>{{ item[1] }}</button></div>
    <p v-if="loading" class="hint">正在读取传感器元数据…</p>
    <div v-else-if="!detail" class="empty-state">暂无传感器。先在“传感器资源”中创建资源，再维护八元组。</div>
    <div v-else class="panel editor">
      <template v-if="tab === 'general'">
        <label>传感器名称<input v-model="draft.sensorName" /></label><label>平台名称<input v-model="draft.name" /></label><label>资源编码<input v-model="draft.identifier" /></label><label>型号<input v-model="draft.model" /></label><label>厂商<input v-model="draft.manufacturer" /></label><label>所属单位<input v-model="draft.owner" /></label><label>状态<select v-model="draft.status"><option value="active">启用</option><option value="offline">离线</option><option value="maintenance">维护</option><option value="inactive">停用</option></select></label><label>说明<textarea v-model="draft.description" rows="2"></textarea></label>
      </template>
      <template v-else-if="tab === 'attributes'">
        <label>空间分辨率（m）<input v-model.number="draft.spatialResolutionM" type="number" /></label><label>时间分辨率（秒）<input v-model.number="draft.temporalResolutionSeconds" type="number" /></label><label>准确度（%）<input v-model.number="draft.accuracyPercent" type="number" /></label><label>可靠度（%）<input v-model.number="draft.reliabilityPercent" type="number" /></label><label>感知原理与能力<textarea v-model="draft.capabilityText" rows="3" placeholder="保存前会保留既有结构化能力；详细量测项见下方"></textarea></label><div class="metadata-list"><strong>感知要素 / 量测项</strong><span v-for="item in draft.measurementItems || []" :key="item.id">{{ item.name }}（{{ item.code }}） · {{ item.unit }}</span></div>
      </template>
      <template v-else-if="tab === 'spatiotemporal'">
        <label>坐标系<input v-model="draft.coordinateSystem" /></label><label>时间参考<input v-model="draft.timeReference" /></label><label>有效开始<input v-model="draft.validTimeStart" type="datetime-local" /></label><label>有效结束<input v-model="draft.validTimeEnd" type="datetime-local" /></label><label>重访周期<input v-model="draft.revisitCycle" /></label>
      </template>
      <template v-else-if="tab === 'geographic'">
        <label>位置 WKT<textarea v-model="draft.locationWkt" rows="2"></textarea></label><label>高度（m）<input v-model.number="draft.heightM" type="number" /></label><label>轨迹 WKT<textarea v-model="draft.trajectoryWkt" rows="2"></textarea></label><label>覆盖范围 WKT<textarea v-model="draft.coverageWkt" rows="3"></textarea></label>
      </template>
      <template v-else-if="tab === 'history'">
        <div v-if="detail.history?.length" class="metadata-list"><span v-for="item in detail.history" :key="item.id">{{ item.event_type }} · {{ item.occurred_at }} · {{ item.description }}</span></div><div v-else class="empty-inline">暂无历史事件</div>
        <label>事件类型<select v-model="historyDraft.eventType"><option value="deployment">部署</option><option value="calibration">校准</option><option value="maintenance">维护</option><option value="fault">故障</option><option value="capability_change">能力变化</option></select></label><label>发生时间<input v-model="historyDraft.occurredAt" type="datetime-local" /></label><label>说明<textarea v-model="historyDraft.description" rows="2"></textarea></label>
      </template>
      <template v-else-if="tab === 'contact'">
        <label>责任单位<input v-model="draft.responsibleOrganization" /></label><label>责任部门<input v-model="draft.responsibleDepartment" /></label><label>负责人<input v-model="draft.responsiblePerson" /></label><label>运维联系人<input v-model="draft.maintenanceContact" /></label>
      </template>
      <template v-else-if="tab === 'constraints' || tab === 'interfaces'">
        <label>{{ tab === 'constraints' ? '环境、权限、共享、安全、成本和调度约束 JSON' : '数据、观测、规划服务接口 JSON（凭据只写环境变量引用）' }}<textarea v-model="jsonDraft" rows="14" class="mono"></textarea></label>
      </template>
      <button class="btn primary" :disabled="saving" @click="saveCurrent">保存{{ tabs.find((item) => item[0] === tab)?.[1] }}</button>
    </div>
  </section>
</template>

<style scoped>
.metadata-page { padding-bottom: 1rem; }
.octuple-mark { display: grid; place-items: center; width: 34px; height: 34px; border: 2px solid #0d756b; border-radius: 50%; color: #0d756b; font: 700 18px/1 Georgia, serif; }
.sensor-select { width: 100%; margin: .35rem 0 .55rem; }
.octuple-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: .25rem; }
.octuple-tabs button { display: flex; align-items: center; gap: .35rem; padding: .36rem; border: 1px solid #d6e0de; background: rgba(255,255,255,.9); color: #536965; font-size: 11px; text-align: left; }
.octuple-tabs button span { display: grid; place-items: center; width: 18px; height: 18px; background: #edf3f2; border-radius: 50%; font: 10px/1 ui-monospace, monospace; }
.octuple-tabs button.active { color: #0b645c; border-color: #67a49d; background: #eff8f6; }
.editor { display: grid; gap: .45rem; margin-top: .55rem; }
.editor label { display: grid; gap: .18rem; color: #536965; font-size: 11px; }
.metadata-list { display: grid; gap: .25rem; padding: .45rem; background: #f5f8f7; color: #465d59; font-size: 11px; }
.empty-state, .empty-inline { padding: .8rem; border: 1px dashed #bac9c6; color: #667a76; text-align: center; font-size: 11px; }
.mono { font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.ok-text { color: #087066; font-size: 12px; }
</style>
