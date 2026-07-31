<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import type { AssistantAction } from '../api/endpoints'
import { selectShellFeature } from '../gis/mapShell'
import { readAiPreferences, saveAiPreferences, type AiPreferences, type AiTaskMode } from '../utils/aiPreferences'

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
const unread = ref(false)
const bodyEl = ref<HTMLElement | null>(null)
let nextId = 0

const WELCOME =
  '你好，我是系统 AI 助手。你可以用一句话让我创建观测任务、查任务进展、看数据质量或盘点传感资源。'

onMounted(async () => {
  messages.value = [{ id: ++nextId, role: 'assistant', text: WELCOME }]
  suggestions.value = ['帮我创建武汉暴雨观测任务', '查看任务列表', '数据质量怎么样', '有哪些传感资源']
  try {
    const res = await api.assistantStatus()
    const d = res.data
    assistantStatus.value = d
    statusLine.value =
      d.mode === 'api'
        ? d.ready
          ? `外部模型 · ${d.model}`
          : '外部模型未配置，已回退内置规则'
        : '内置规则模式 · 无需联网'
  } catch {
    statusLine.value = ''
    assistantStatus.value = null
  }
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    unread.value = false
    void nextTick(scrollBottom)
  }
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

function saveSettings() {
  saveAiPreferences(preferences.value)
  settingsMessage.value = '已保存，并同步到综合感知任务入口。'
}

function scrollBottom() {
  const el = bodyEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send(text?: string) {
  const msg = (text ?? input.value).trim()
  if (!msg || sending.value) return
  input.value = ''
  messages.value.push({ id: ++nextId, role: 'user', text: msg })
  sending.value = true
  await nextTick(scrollBottom)
  try {
    const res = await api.assistantChat(msg)
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
            <strong>{{ assistantStatus?.model || '状态暂不可用' }}</strong>
            <p v-if="assistantStatus">{{ assistantStatus.ready ? '服务已就绪' : '服务未就绪，系统会按后端策略回退' }} · {{ assistantStatus.mode === 'api' ? '外部模型' : '内置规则' }}</p>
            <p v-else>未能读取服务状态，不影响保存本地运行偏好。</p>
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

          <p class="assistant-security-note">模型、服务地址和密钥由服务器环境管理。浏览器只保存以上偏好，不保存 API Key。</p>
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
