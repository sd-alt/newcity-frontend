<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../api/endpoints'
import type { AssistantAction } from '../api/endpoints'
import { selectShellFeature } from '../gis/mapShell'

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
    statusLine.value =
      d.mode === 'api'
        ? d.ready
          ? `外部模型 · ${d.model}`
          : '外部模型未配置，已回退内置规则'
        : '内置规则模式 · 无需联网'
  } catch {
    statusLine.value = ''
  }
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    unread.value = false
    void nextTick(scrollBottom)
  }
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
          <button type="button" class="assistant-close" aria-label="收起助手" @click="toggle">×</button>
        </header>

        <div ref="bodyEl" class="assistant-body">
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

        <div v-if="suggestions.length && !sending" class="assistant-suggests">
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

        <footer class="assistant-input">
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
        <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" />
        <path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
      </svg>
      <span v-else aria-hidden="true">×</span>
    </button>
  </div>
</template>