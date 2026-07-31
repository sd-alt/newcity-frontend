<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as api from '../api/endpoints'
import CardPager from '../components/CardPager.vue'
import { errMessage } from '../utils/errors'

type Row = Record<string, any>
const items = ref<Row[]>([])
const scenes = ref<Row[]>([])
const services = ref<Row[]>([])
const observations = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 4
const workspacePage = ref(1)
const workspacePages = ['新增或编辑知识', '浏览知识资源']
const form = ref({ id: '', code: '', title: '', itemType: 'historical_case', sceneId: '', content: '', keywords: '', sourceReference: '' })
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return items.value.filter((item) => !q || `${item.code} ${item.title} ${item.content}`.toLowerCase().includes(q))
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const listPageLabels = computed(() => Array.from({ length: pageCount.value }, (_, index) => `知识资源第 ${index + 1} 页`))
function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : [] }
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [knowledge, sceneRes, serviceRes, observationRes] = await Promise.all([
      api.listKnowledgeItems(), api.listScenes(), api.listAlgorithmServices(), api.listOmObservations('?page=1&pageSize=5'),
    ])
    items.value = rows(knowledge.data); scenes.value = rows(sceneRes.data); services.value = rows(serviceRes.data); observations.value = rows(observationRes.data)
  } catch (cause) { error.value = errMessage(cause, '知识资源加载失败') }
  finally { loading.value = false }
}
function edit(item: Row) {
  form.value = { id: String(item.id), code: item.code, title: item.title, itemType: item.itemType, sceneId: item.sceneId ? String(item.sceneId) : '', content: item.content, keywords: (item.keywords || []).join('，'), sourceReference: item.sourceReference || '' }
  workspacePage.value = 1
}
function reset() { form.value = { id: '', code: '', title: '', itemType: 'historical_case', sceneId: '', content: '', keywords: '', sourceReference: '' } }
async function save() {
  if (!form.value.code.trim() || !form.value.title.trim() || !form.value.content.trim()) { error.value = '请填写编码、标题和知识内容'; return }
  saving.value = true
  try {
    const body = { code: form.value.code, title: form.value.title, itemType: form.value.itemType, sceneId: form.value.sceneId ? Number(form.value.sceneId) : null, content: form.value.content, keywords: form.value.keywords.split(/[，,]/).map((item) => item.trim()).filter(Boolean), sourceReference: form.value.sourceReference, status: 'active' }
    if (form.value.id) await api.updateKnowledgeItem(form.value.id, body)
    else await api.createKnowledgeItem(body)
    message.value = form.value.id ? '知识条目已更新' : '知识条目已创建'
    reset(); await load(); workspacePage.value = 2
  } catch (cause) { error.value = errMessage(cause, '知识条目保存失败') }
  finally { saving.value = false }
}
async function remove(item: Row) {
  if (!window.confirm(`删除知识条目“${item.title}”？已关联任务时系统会提示限制。`)) return
  try { await api.deleteKnowledgeItem(item.id); message.value = '知识条目已删除'; await load() }
  catch (cause) { error.value = errMessage(cause, '知识条目删除失败') }
}
onMounted(load)
</script>

<template>
  <section class="page knowledge-page">
    <header class="page-head"><div><p class="eyebrow">标准 · 规则 · 案例</p><h1>知识检索与应用</h1></div></header>
    <p class="hint">知识与场景、指标、传感器和算法关联，为指标推荐、评分解释和方案优化提供依据。</p>
    <p v-if="error" class="error">{{ error }}</p><p v-if="message" class="ok-text">{{ message }}</p>
    <div v-if="workspacePage === 1" class="panel form-grid">
      <h3>{{ form.id ? '编辑知识条目' : '新建知识条目' }}</h3>
      <div class="split"><input v-model="form.code" placeholder="知识编码" /><select v-model="form.itemType"><option value="standard">标准规范</option><option value="indicator_rule">指标规则</option><option value="sensor">传感器知识</option><option value="algorithm">算法说明</option><option value="business_rule">业务规则</option><option value="experience">专家经验</option><option value="historical_case">历史任务案例</option></select></div>
      <input v-model="form.title" placeholder="知识标题" /><select v-model="form.sceneId"><option value="">通用场景</option><option v-for="scene in scenes" :key="scene.id" :value="String(scene.id)">{{ scene.name }}</option></select>
      <textarea v-model="form.content" rows="4" placeholder="知识正文或案例结论"></textarea><input v-model="form.keywords" placeholder="关键词，以逗号分隔" /><input v-model="form.sourceReference" placeholder="来源或标准引用" />
      <div class="actions"><button class="btn primary" :disabled="saving" @click="save">{{ form.id ? '保存修改' : '创建条目' }}</button><button v-if="form.id" class="btn ghost" @click="reset">取消编辑</button></div>
    </div>
    <section v-if="workspacePage === 2" class="panel knowledge-results">
      <header class="section-card-head"><h3>知识资源</h3><span>共 {{ filtered.length }} 条</span></header>
      <div class="knowledge-search"><input v-model="keyword" class="search" type="search" placeholder="检索编码、标题或正文" @input="page = 1" /></div>
      <p v-if="loading" class="hint">正在加载知识资源…</p>
      <div v-else-if="paged.length" class="knowledge-list"><article v-for="item in paged" :key="item.id"><div><span>{{ item.itemType }}</span><strong>{{ item.title }}</strong><p>{{ item.content }}</p><small>{{ item.code }} · {{ (item.keywords || []).join(' / ') }}</small></div><div class="row-actions"><button @click="edit(item)">编辑</button><button class="danger" @click="remove(item)">删除</button></div></article></div>
      <div v-else class="empty-state">没有匹配的知识条目。可先录入标准、业务规则或历史任务案例。</div>
      <CardPager v-model:page="page" kind="records" :pages="listPageLabels" :summary="`共 ${filtered.length} 条`" label="知识资源分页" />
      <div class="resource-evidence"><div><span>算法服务</span><strong>{{ services.length }}</strong><small>由业务中心和 Agent 通过统一工具调用</small></div><div><span>O&amp;M 观测记录</span><strong>{{ observations.length }}</strong><small>区分实际观测结果与资源能力</small></div></div>
    </section>
    <CardPager v-model:page="workspacePage" :pages="workspacePages" label="知识库内容分页" />
  </section>
</template>

<style scoped>
.knowledge-page { padding-bottom: 1rem; }
.form-grid { display: grid; gap: .4rem; }
.form-grid h3 { margin: 0; color: #3a3a3c; font-size: 13px; }
.knowledge-results { margin-top: .6rem; }
.section-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }.section-card-head h3 { margin: 0; }.section-card-head span { color: #6e6e73; font-size: 10px; white-space: nowrap; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }.actions,.row-actions { display: flex; gap: .35rem; }.knowledge-search { margin-bottom: .45rem; }.search { width: 100%; margin: 0; }
.knowledge-list { display: grid; gap: .4rem; padding: .42rem; border-radius: 12px; background: #f3f4f6; }.knowledge-list article { display: flex; justify-content: space-between; gap: .55rem; padding: .6rem; border: 1px solid #e1e3e6; border-radius: 10px; background: #fff; }.knowledge-list article > div:first-child { display: grid; min-width: 0; gap: .16rem; }.knowledge-list span { width: max-content; padding: .08rem .25rem; border-radius: 4px; background: #f3f4f6; color: #515154; font-size: 9px; }.knowledge-list strong { color: #3a3a3c; font-size: 12px; }.knowledge-list p { margin: 0; max-height: 3.2em; overflow: hidden; color: #515154; font-size: 11px; }.knowledge-list small { color: #6e6e73; }.row-actions { flex-direction: column; }.row-actions button { min-width: 36px; min-height: 28px; padding: .25rem .35rem; border: 0; border-radius: 7px; background: transparent; color: var(--brand); font-size: 10px; cursor: pointer; }.row-actions button:hover { background: var(--brand-soft); }.row-actions .danger { color: #a33a31; }
.pager { display: flex; justify-content: center; gap: .5rem; margin: .5rem 0; font-size: 11px; }.pager button { border: 0; background: transparent; color: var(--brand); }.resource-evidence { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; padding-top: .5rem; border-top: 1px solid #eceef1; }.resource-evidence div { display: grid; gap: .1rem; padding: .5rem; border-radius: 10px; background: #f3f4f6; }.resource-evidence span,.resource-evidence small { color: #6e6e73; font-size: 10px; }.resource-evidence strong { color: #3a3a3c; font: 600 16px/1.2 inherit; }.empty-state { padding: 1rem; border: 1px dashed #cfd3d8; color: #6e6e73; text-align: center; font-size: 11px; }.ok-text { color: #247347; font-size: 12px; }
</style>
