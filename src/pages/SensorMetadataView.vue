<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import * as api from '../api/endpoints'
import ContextGuide from '../components/ContextGuide.vue'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const route = useRoute()
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
const tabBriefs: Record<string, string> = {
  general: '它是谁、属于哪个平台',
  attributes: '能测什么、测得多准',
  spatiotemporal: '何时有效、采用什么时间与坐标参考',
  geographic: '在哪里、覆盖到哪里',
  history: '部署、校准、维护和故障记录',
  contact: '谁负责、由谁运维',
  constraints: '使用、共享、安全和调度边界',
  interfaces: '数据与服务怎样接入',
}
const metadataGuideSteps = [
  { title: '从资源列表进入', detail: '先确认当前传感器及其所属平台，避免把资料维护到错误资源。' },
  { title: '优先补齐关键档案', detail: '身份与归属、观测能力、地理定位直接影响候选筛选和规划计算。' },
  { title: '有真实依据再维护', detail: '历史、联系人、约束和接口按实际资料填写，不需要为了凑齐八类而虚构内容。' },
]
const filteredSensors = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return sensors.value.filter((item) => !q || `${item.sensorName || item.name || ''} ${item.platformName || ''}`.toLowerCase().includes(q))
})
const currentTabBrief = computed(() => tabBriefs[tab.value] || '')

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.values(value as Row).some(hasContent)
  return value !== null && value !== undefined && value !== ''
}
function isSectionComplete(key: string) {
  if (!detail.value) return false
  if (key === 'attributes') return hasContent(detail.value.attributes) || hasContent(detail.value.measurementItems)
  return hasContent(detail.value[key])
}
const completedSectionCount = computed(() => tabs.filter(([key]) => isSectionComplete(key)).length)

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
    const requestedId = typeof route.query.sensorId === 'string' ? route.query.sensorId : ''
    const requestedSensor = sensors.value.find((item) => String(item.id) === requestedId)
    const firstSensor = sensors.value[0]
    const initialSensor = requestedSensor || firstSensor
    if (!selectedId.value && initialSensor) selectedId.value = String(initialSensor.id)
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
    <header class="page-head resource-head">
      <div><p class="eyebrow">资源档案 · 八类元数据</p><h1>传感器详情</h1></div>
      <RouterLink :to="{ name: 'resource-sensors', query: { tab: 'crud' } }" class="back-link">返回资源列表</RouterLink>
    </header>
    <ContextGuide
      storage-key="newcity-sensor-profile-guide"
      kicker="资源档案怎么用"
      title="八类档案并列，不是必须依次完成的八步"
      summary="这些信息共同描述一个传感器，并供资源检索、规划匹配和运行维护复用。"
      :steps="metadataGuideSteps"
      reopen-label="查看档案说明"
    />
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>
    <input v-model="keyword" type="search" placeholder="搜索传感器或平台" />
    <select v-model="selectedId" class="sensor-select" @change="loadDetail"><option value="">选择传感器</option><option v-for="item in filteredSensors" :key="item.id" :value="String(item.id)">{{ item.sensorName || item.name || `传感器 #${item.id}` }} · {{ item.platformName || '' }}</option></select>
    <p v-if="loading" class="hint">正在读取传感器元数据…</p>
    <div v-else-if="!detail" class="empty-state">暂无传感器。先在“传感器资源”中创建资源，再维护资源档案。</div>
    <template v-else>
      <article class="sensor-context">
        <div><span>{{ detail.type || '传感器' }}</span><em :class="String(detail.platformStatus || detail.general?.status || '')">{{ detail.platformStatus || detail.general?.status || '状态未登记' }}</em></div>
        <strong>{{ detail.name || detail.general?.sensorName }}</strong>
        <p>{{ detail.platformName || detail.general?.name || '未关联平台' }} · {{ detail.general?.identifier || `传感器 #${ detail.id }` }}</p>
        <div class="profile-progress"><i :style="{ width: (completedSectionCount / tabs.length * 100) + '%' }"></i></div>
        <small>已维护 {{ completedSectionCount }} / {{ tabs.length }} 类档案；空白类别可以在获得真实资料后补充。</small>
      </article>
      <div class="octuple-heading"><strong>资源档案</strong><small>选择需要维护的内容</small></div>
      <div class="octuple-tabs" role="tablist">
        <button v-for="item in tabs" :key="item[0]" :class="{ active: tab === item[0] }" @click="selectTab(item[0])">
          <i :class="{ complete: isSectionComplete(item[0]) }" aria-hidden="true"></i>
          <span><strong>{{ item[1] }}</strong><small>{{ tabBriefs[item[0]] }}</small></span>
        </button>
      </div>
      <div class="panel editor">
        <div class="editor-head"><div><p class="eyebrow">当前档案</p><h3>{{ tabs.find((item) => item[0] === tab)?.[1] }}</h3></div><small>{{ currentTabBrief }}</small></div>
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
    </template>
  </section>
</template>

<style scoped>
.metadata-page { padding-bottom: 1rem; }
.resource-head { align-items: flex-start; }
.back-link { color: #176e66; font-size: 10px; text-decoration: none; border-bottom: 1px solid #8bb7b1; }
.sensor-select { width: 100%; margin: .35rem 0 .55rem; }
.sensor-context { display: grid; gap: .25rem; padding: .65rem; border: 1px solid #c9d8d5; border-top: 3px solid #287b78; background: rgba(255,255,255,.94); }
.sensor-context > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: .35rem; }
.sensor-context span { color: #8a682a; font-size: 10px; }
.sensor-context em { padding: .1rem .35rem; background: #edf2f1; color: #5d716e; font-size: 9px; font-style: normal; }
.sensor-context em.active { background: #e8f5f1; color: #087066; }
.sensor-context > strong { color: #173f43; font-size: 14px; overflow-wrap: anywhere; }
.sensor-context p, .sensor-context small { margin: 0; color: #637774; font-size: 10px; line-height: 1.45; }
.profile-progress { height: 4px; overflow: hidden; background: #e2e9e7; }
.profile-progress i { display: block; height: 100%; background: #287b78; }
.octuple-heading { display: flex; align-items: baseline; justify-content: space-between; gap: .4rem; margin: .65rem 0 .3rem; }
.octuple-heading strong { color: #173f43; font-size: 12px; }
.octuple-heading small { color: #6b7d7a; font-size: 9px; }
.octuple-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: .25rem; }
.octuple-tabs button { display: grid; grid-template-columns: .55rem 1fr; align-items: start; gap: .35rem; min-width: 0; padding: .42rem; border: 1px solid #d6e0de; background: rgba(255,255,255,.9); color: #536965; text-align: left; }
.octuple-tabs button > i { width: 6px; height: 6px; margin-top: .22rem; border: 1px solid #9eafac; border-radius: 50%; background: #fff; }
.octuple-tabs button > i.complete { border-color: #287b78; background: #287b78; }
.octuple-tabs button > span { display: grid; gap: .08rem; min-width: 0; }
.octuple-tabs button strong { color: inherit; font-size: 11px; }
.octuple-tabs button small { color: #748582; font-size: 9px; line-height: 1.3; }
.octuple-tabs button.active { color: #0b645c; border-color: #67a49d; background: #eff8f6; }
.editor { display: grid; gap: .45rem; margin-top: .55rem; }
.editor-head { display: flex; align-items: flex-end; justify-content: space-between; gap: .45rem; padding-bottom: .4rem; border-bottom: 1px solid #e1e8e6; }
.editor-head p, .editor-head h3 { margin: 0; }
.editor-head h3 { color: #173f43; font-size: 13px; }
.editor-head > small { max-width: 55%; color: #687b78; font-size: 9px; text-align: right; }
.editor label { display: grid; gap: .18rem; color: #536965; font-size: 11px; }
.metadata-list { display: grid; gap: .25rem; padding: .45rem; background: #f5f8f7; color: #465d59; font-size: 11px; }
.empty-state, .empty-inline { padding: .8rem; border: 1px dashed #bac9c6; color: #667a76; text-align: center; font-size: 11px; }
.mono { font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.ok-text { color: #087066; font-size: 12px; }
</style>
