<script setup lang="ts">
type Action = {
  type: string
  title: string
  description: string
  severity?: string
  primaryAction?: { key: string; label: string; approvalId?: number | null }
  secondaryActions?: Array<{ key: string; label: string }>
  blockingReasons?: string[]
}

const props = defineProps<{ action: Action | null; disabled?: boolean; activeKey?: string | null }>()
const emit = defineEmits<{
  primary: []
  secondary: [key: string]
}>()
</script>

<template>
  <section v-if="action" class="current-action-panel" :class="`severity-${action.severity || 'info'}`" aria-label="当前需要处理的事项">
    <div class="current-action-copy">
      <span class="current-action-label">当前需要处理</span>
      <strong>{{ action.title }}</strong>
      <p>{{ action.description }}</p>
      <ul v-if="action.blockingReasons?.length" class="current-action-reasons">
        <li v-for="reason in action.blockingReasons" :key="reason">{{ reason }}</li>
      </ul>
    </div>
    <div class="current-action-buttons">
      <button class="btn primary" :disabled="disabled || Boolean(props.activeKey)" @click="emit('primary')">{{ props.activeKey === action.primaryAction?.key ? '正在提交…' : (action.primaryAction?.label || '处理') }}</button>
      <details v-if="action.secondaryActions?.length" class="current-action-more">
        <summary>更多</summary>
        <div>
          <button v-for="item in action.secondaryActions" :key="item.key" class="btn ghost tiny" :disabled="disabled || Boolean(props.activeKey)" @click="emit('secondary', item.key)">{{ props.activeKey === item.key ? '正在提交…' : item.label }}</button>
        </div>
      </details>
    </div>
  </section>
</template>

<style scoped>
.current-action-panel { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: .55rem; padding: .8rem; border: 1px solid #cfe0ef; border-left: 4px solid #4b8fc6; border-radius: 12px; background: #f5faff; scroll-margin-top: 5rem; }
.current-action-panel.severity-warning { border-color: #ead3a7; border-left-color: #d19739; background: #fffaf0; }
.current-action-panel.severity-error { border-color: #e0aca7; border-left-color: #b23730; background: #fff8f7; }
.current-action-panel.severity-success { border-color: #b9ddca; border-left-color: #4b9a70; background: #f5fbf7; }
.current-action-copy { min-width: 0; }.current-action-label { color: #63798d; font-size: 12px; }.current-action-copy strong { display: block; margin-top: .18rem; color: #263746; font-size: 16px; }.current-action-copy p { margin: .22rem 0 0; color: #52616d; font-size: 13px; line-height: 1.45; }.current-action-reasons { margin: .35rem 0 0; padding-left: 1.1rem; color: #8b5b0d; font-size: 12px; }.current-action-buttons { display: flex; align-items: center; gap: .35rem; flex: none; }.current-action-more { position: relative; }.current-action-more summary { cursor: pointer; padding: .45rem .6rem; color: #52616d; font-size: 12px; }.current-action-more > div { position: absolute; z-index: 5; right: 0; display: grid; min-width: 140px; gap: .25rem; padding: .4rem; border: 1px solid #d9e1e8; border-radius: 8px; background: #fff; box-shadow: 0 7px 20px rgba(39,58,74,.12); }
@media (max-width: 700px) { .current-action-panel { align-items: stretch; flex-direction: column; }.current-action-buttons { justify-content: flex-end; } }
</style>
