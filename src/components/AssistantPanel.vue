<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import type { AssistantAction } from '../api/endpoints'
import { selectShellFeature } from '../gis/mapShell'
import {
  readAiPreferences,
  saveAiPreferences,
  type AiPreferences,
  type AiServiceMode,
  type AiTaskMode,
} from '../utils/aiPreferences'

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantAction[]
  error?: boolean
}

const router = useRouter()
const open = ref(false)
const sending = ref(false)
const input = ref('')
const messages = ref<ChatMessage[]>([])
const suggestions = ref<string[]>([])
const statusLine = ref('')
const assistantStatus = ref<api.AssistantStatusData | null>(null)
const view = ref<'chat' | 'settings'>('chat')
const preferences = ref<AiPreferences>(readAiPreferences())
const settingsMessage = ref('')
const apiKeyInput = ref('')
const availableModels = ref<string[]>([])
const loadingModels = ref(false)
const unread = ref(false)
const bodyEl = ref<HTMLElement | null>(null)
const pendingActions = ref<api.AgentPendingAction[]>([])
let pendingTimer: number | null = null
let pendingSignature = ''
let nextId = 0

const WELCOME =
  '你好，我是系统 AI 助手。你可以用一句话让我创建观测任务、查任务进展、看数据质量或盘点传感资源。'

onMounted(async () => {
  void refreshPendingActions()
  pendingTimer = window.setInterval(() => void refreshPendingActions(), 10000)
  messages.value = [{ id: ++nextId, role: 'assistant', text: WELCOME }]
  suggestions.value = ['帮我创建武汉暴雨观测任务', '查看任务列表', '数据质量怎么样', '有哪些传感资源']
  try {
    const res = await api.assistantStatus()
    const d = res.data
    assistantStatus.value = d
    statusLine.value = preferences.value.serviceMode === 'api'
      ? d.apiConfigured ? `统一 AI 模型 · ${d.model}` : '统一 AI 模型 · 等待服务器配置'
      : '内置预设模式 · 不调用模型服务'
  } catch {
    statusLine.value = ''
    assistantStatus.value = null
  }
})

onUnmounted(() => {
  if (pendingTimer != null) window.clearInterval(pendingTimer)
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    unread.value = false
    void refreshPendingActions()
    void nextTick(scrollBottom)
  }
}

async function refreshPendingActions() {
  try {
    const response = await api.listAgentPendingActions()
    const next = response.data || []
    const signature = next.map((item) => `${item.runId}:${item.approvalId}:${item.status}`).join('|')
    if (signature !== pendingSignature && next.length && !open.value) unread.value = true
    pendingSignature = signature
    pendingActions.value = next
  } catch {
    pendingActions.value = []
  }
}

async function openPendingAction(action: api.AgentPendingAction) {
  await router.push({ path: '/application/tasks', query: { runId: action.runId, focus: 'human-action' } })
  open.value = false
}

function pendingActionLabel(action: api.AgentPendingAction) {
  return action.actionType === 'input' ? '补充信息' : '查看并确认'
}

function openView(value: 'chat' | 'settings') {
  view.value = value
  settingsMessage.value = ''
  if (value === 'settings') preferences.value = readAiPreferences()
  else void nextTick(scrollBottom)
}

function chooseDefaultMode(value: AiTaskMode) {
  preferences.value = { ...preferences.value, defaultTaskMode: value }
}

function chooseServiceMode(value: AiServiceMode) {
  preferences.value = { ...preferences.value, serviceMode: value }
  if (value === 'preset') statusLine.value = '内置预设模式 · 不调用模型服务'
  else if (assistantStatus.value?.apiConfigured) statusLine.value = `统一 AI 模型 · ${assistantStatus.value.model}`
  else statusLine.value = '统一 AI 模型 · 等待服务器配置'
}

async function loadModels() {
  const apiBase = preferences.value.apiBase.trim()
  const apiKey = apiKeyInput.value.trim()
  if (!apiBase || !apiKey) {
    settingsMessage.value = '请先填写 API 地址和 API Key。'
    return
  }
  loadingModels.value = true
  settingsMessage.value = ''
  try {
    const response = await api.assistantModels({ apiBase, apiKey, model: preferences.value.model.trim() })
    availableModels.value = response.data.models || []
    const firstModel = availableModels.value[0]
    if (!preferences.value.model && firstModel) {
      preferences.value = { ...preferences.value, model: firstModel }
    }
    settingsMessage.value = availableModels.value.length
      ? `已拉取 ${availableModels.value.length} 个模型。API Key 只保留在当前页面。`
      : '接口连接成功，但没有返回可用模型。'
  } catch (err) {
    settingsMessage.value = err instanceof Error ? `拉取模型失败：${err.message}` : '拉取模型失败，请检查地址和密钥。'
  } finally {
    loadingModels.value = false
  }
}

function saveSettings() {
  saveAiPreferences(preferences.value)
  settingsMessage.value = '已保存。API Key 仅保留在当前页面，不会写入浏览器存储。'
}

function scrollBottom() {
  const el = bodyEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send(text?: string) {
  const msg = (text ?? input.value).trim()
  if (!msg || sending.value) return
  const hasApiOverride = Boolean(preferences.value.apiBase.trim() || preferences.value.model.trim() || apiKeyInput.value.trim())
  if (preferences.value.serviceMode === 'api' && hasApiOverride) {
    if (!preferences.value.apiBase.trim() || !apiKeyInput.value.trim() || !preferences.value.model.trim()) {
      view.value = 'settings'
      settingsMessage.value = 'API 模式下请完整填写地址、API Key 和模型，或全部留空使用服务器配置。'
      return
    }
  }
  const apiConfig = preferences.value.serviceMode === 'api' && hasApiOverride
    ? {
        apiBase: preferences.value.apiBase.trim(),
        apiKey: apiKeyInput.value.trim(),
        model: preferences.value.model.trim(),
      }
    : undefined
  input.value = ''
  messages.value.push({ id: ++nextId, role: 'user', text: msg })
  sending.value = true
  await nextTick(scrollBottom)
  try {
    const res = await api.assistantChat(msg, preferences.value.serviceMode, apiConfig)
    const d = res.data
    messages.value.push({
      id: ++nextId,
      role: 'assistant',
      text: d.reply,
      actions: d.actions?.length ? d.actions : undefined,
    })
    if (Array.isArray(d.suggestions) && d.suggestions.length) suggestions.value = d.suggestions
    if (!open.value) unread.value = true
  } catch (err) {
    messages.value.push({
      id: ++nextId,
      role: 'assistant',
      text: err instanceof Error ? '请求失败：' + err.message : '请求失败，请稍后重试',
      error: true,
    })
  } finally {
    sending.value = false
    void refreshPendingActions()
    await nextTick(scrollBottom)
  }
}

async function runAction(action: AssistantAction) {
  if (action.type === 'task_created' && action.taskId != null) {
    await router.push({ path: '/planning', query: { tab: 'tasks' } })
    await new Promise((r) => setTimeout(r, 200))
    void selectShellFeature('task', String(action.taskId), { openBubble: true, fly: true })
    open.value = false
    return
  }
  if (action.route) {
    await router.push({ path: action.route, query: action.tab ? { tab: action.tab } : {} })
    open.value = false
  }
}

function actionLabel(action: AssistantAction) {
  if (action.type === 'task_created') return `查看任务 #${action.taskId}`
  return action.label || '打开'
}
</script>

<template>
  <div class="assistant-root">
    <transition name="assistant-pop">
      <section v-if="open" class="assistant-panel" aria-label="AI 助手">
        <header class="assistant-head">
          <div class="assistant-head-text">
            <strong>AI 助手</strong>
            <span v-if="statusLine" class="assistant-status">{{ statusLine }}</span>
          </div>
          <div class="assistant-head-actions">
            <button type="button" class="assistant-head-button" :class="{ active: view === 'chat' }" @click="openView('chat')">对话</button>
            <button type="button" class="assistant-head-button" :class="{ active: view === 'settings' }" @click="openView('settings')">设置</button>
            <button type="button" class="assistant-close" aria-label="收起助手" @click="toggle">×</button>
          </div>
        </header>

        <div v-if="view === 'chat'" ref="bodyEl" class="assistant-body">
          <div v-if="pendingActions.length" class="assistant-pending-list" aria-live="polite">
            <article v-for="action in pendingActions" :key="`${action.runId}-${action.approvalId}`" class="assistant-pending-card">
              <span>{{ action.actionType === 'input' ? '任务待补充' : '任务待确认' }} · {{ action.stageName }}</span>
              <strong>{{ action.title }}</strong>
              <p>{{ action.description }}</p>
              <small>{{ action.taskName }}</small>
              <button type="button" class="assistant-pending-button" @click="openPendingAction(action)">{{ pendingActionLabel(action) }}</button>
            </article>
          </div>
          <div
            v-for="m in messages"
            :key="m.id"
            class="assistant-msg"
            :class="[m.role, { error: m.error }]"
          >
            <div class="assistant-bubble">
              <p v-for="(line, i) in m.text.split('\n')" :key="i">{{ line }}</p>
              <div v-if="m.actions?.length" class="assistant-actions">
                <button
                  v-for="(a, i) in m.actions"
                  :key="i"
                  type="button"
                  class="assistant-action-btn"
                  @click="runAction(a)"
                >
                  {{ actionLabel(a) }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="sending" class="assistant-msg assistant">
            <div class="assistant-bubble typing">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </div>
          </div>
        </div>

        <div v-else class="assistant-settings">
          <section class="assistant-service-card">
            <span>当前模型服务</span>
            <strong>{{ preferences.serviceMode === 'api' ? (assistantStatus?.model || '等待服务器配置') : '内置预设规则' }}</strong>
            <p v-if="assistantStatus && preferences.serviceMode === 'api'">{{ assistantStatus.apiConfigured ? '右下角助手与多 Agent 工作流共用统一模型网关' : '服务器尚未配置统一模型服务' }}</p>
            <p v-else-if="preferences.serviceMode === 'preset'">本地规则直接处理，不调用模型服务。</p>
            <p v-else>未能读取模型服务状态，不影响保存本地运行偏好。</p>
          </section>

          <fieldset class="assistant-setting-group assistant-service-mode-group">
            <legend>助手运行方式</legend>
            <button type="button" :class="{ active: preferences.serviceMode === 'preset' }" @click="chooseServiceMode('preset')">
              <strong>内置预设模式</strong>
              <small>按系统规则处理，不调用模型服务</small>
            </button>
            <button type="button" :class="{ active: preferences.serviceMode === 'api' }" @click="chooseServiceMode('api')">
              <strong>AI 接入模式</strong>
              <small>与多 Agent 工作流共用服务器模型</small>
            </button>
          </fieldset>

          <section v-if="preferences.serviceMode === 'api'" class="assistant-api-config">
            <div class="assistant-api-config-title">
              <strong>当前助手 API 配置</strong>
              <small>留空时使用服务器默认配置</small>
            </div>
            <label class="assistant-config-field">
              <span>API 地址</span>
              <input v-model="preferences.apiBase" type="url" placeholder="https://api.example.com/v1" autocomplete="url" />
            </label>
            <label class="assistant-config-field">
              <span>API Key</span>
              <input v-model="apiKeyInput" type="password" placeholder="仅当前页面有效" autocomplete="new-password" />
            </label>
            <div class="assistant-model-row">
              <label class="assistant-config-field">
                <span>模型</span>
                <input v-model="preferences.model" list="assistant-model-options" placeholder="例如 gpt-4o-mini" />
                <datalist id="assistant-model-options">
                  <option v-for="model in availableModels" :key="model" :value="model" />
                </datalist>
              </label>
              <button type="button" class="assistant-model-load" :disabled="loadingModels" @click="loadModels">
                {{ loadingModels ? '拉取中…' : '拉取模型' }}
              </button>
            </div>
            <small class="assistant-api-hint">API Key 只用于当前助手会话和模型拉取，不保存到浏览器或服务器。</small>
          </section>

          <fieldset class="assistant-setting-group">
            <legend>默认任务方式</legend>
            <button type="button" :class="{ active: preferences.defaultTaskMode === 'manual' }" @click="chooseDefaultMode('manual')"><strong>手动创建</strong><small>直接保存需求与任务草案</small></button>
            <button type="button" :class="{ active: preferences.defaultTaskMode === 'assisted' }" @click="chooseDefaultMode('assisted')"><strong>AI 辅助</strong><small>先生成草案，再由人工确认</small></button>
            <button type="button" :class="{ active: preferences.defaultTaskMode === 'agent' }" @click="chooseDefaultMode('agent')"><strong>多 Agent</strong><small>专业 Agent 协同，关键节点人工确认</small></button>
          </fieldset>

          <label class="assistant-detail-toggle">
            <input v-model="preferences.showTechnicalDetails" type="checkbox" />
            <span><strong>显示技术运行记录</strong><small>在任务页展示工具调用、数据来源和耗时</small></span>
          </label>

          <p class="assistant-security-note">多 Agent 工作流仍使用服务器配置；本页 API 配置只影响当前 AI 助手，API Key 不会持久化。</p>
          <button type="button" class="assistant-save" @click="saveSettings">保存设置</button>
          <p v-if="settingsMessage" class="assistant-settings-message">{{ settingsMessage }}</p>
        </div>

        <div v-if="view === 'chat' && suggestions.length && !sending" class="assistant-suggests">
          <button
            v-for="sg in suggestions"
            :key="sg"
            type="button"
            class="assistant-suggest"
            @click="send(sg)"
          >
            {{ sg }}
          </button>
        </div>

        <footer v-if="view === 'chat'" class="assistant-input">
          <input
            v-model="input"
            type="text"
            placeholder="用一句话描述你要做的事…"
            :disabled="sending"
            @keydown.enter="send()"
          />
          <button type="button" class="assistant-send" :disabled="sending || !input.trim()" @click="send()">
            发送
          </button>
        </footer>
      </section>
    </transition>

    <button
      type="button"
      class="assistant-fab"
      :class="{ open, unread }"
      :aria-label="open ? '收起 AI 助手' : '打开 AI 助手'"
      @click="toggle"
    >
      <svg v-if="!open" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
        <path d="M8 9h8M8 12h5" />
      </svg>
      <span v-else aria-hidden="true">×</span>
    </button>
  </div>
</template>
