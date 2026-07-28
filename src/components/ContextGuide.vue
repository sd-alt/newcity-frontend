<script setup lang="ts">
import { onMounted, ref } from 'vue'

type GuideStep = { title: string; detail: string }

const props = defineProps<{
  storageKey: string
  kicker: string
  title: string
  summary: string
  steps: GuideStep[]
  reopenLabel?: string
}>()

const visible = ref(true)

onMounted(() => {
  try {
    visible.value = window.localStorage.getItem(props.storageKey) !== 'hidden'
  } catch {
    visible.value = true
  }
})

function hideGuide() {
  visible.value = false
  try { window.localStorage.setItem(props.storageKey, 'hidden') } catch { /* storage may be unavailable */ }
}

function showGuide() {
  visible.value = true
  try { window.localStorage.removeItem(props.storageKey) } catch { /* storage may be unavailable */ }
}
</script>

<template>
  <section v-if="visible" class="context-guide" role="note">
    <header>
      <div><span>{{ kicker }}</span><strong>{{ title }}</strong></div>
      <button type="button" @click="hideGuide">隐藏说明</button>
    </header>
    <p>{{ summary }}</p>
    <ol>
      <li v-for="(step, index) in steps" :key="step.title">
        <b>{{ index + 1 }}</b>
        <span><strong>{{ step.title }}</strong><small>{{ step.detail }}</small></span>
      </li>
    </ol>
  </section>
  <button v-else type="button" class="guide-reopen" @click="showGuide">
    <span aria-hidden="true">?</span>{{ reopenLabel || '查看说明' }}
  </button>
</template>

<style scoped>
.context-guide {
  margin: 0.55rem 0;
  padding: 0.65rem;
  border: 1px solid #c9d8d5;
  border-left: 3px solid #287b78;
  background: #f5f9f8;
}
.context-guide header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.context-guide header div { display: grid; gap: 0.12rem; }
.context-guide header span { color: #8a682a; font-size: 9px; letter-spacing: 0.08em; }
.context-guide header strong { color: #173f43; font-size: 12px; line-height: 1.4; }
.context-guide header button { flex: 0 0 auto; padding: 0; border: 0; background: transparent; color: #607572; font-size: 10px; cursor: pointer; }
.context-guide > p { margin: 0.4rem 0 0.5rem; color: #536966; font-size: 11px; line-height: 1.55; }
.context-guide ol { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.context-guide li { position: relative; display: grid; grid-template-columns: 1.35rem 1fr; gap: 0.4rem; min-width: 0; padding: 0.25rem 0; }
.context-guide li:not(:last-child)::after { content: ''; position: absolute; left: 0.62rem; top: 1.35rem; bottom: -0.15rem; width: 1px; background: #b8cbc7; }
.context-guide li b { z-index: 1; display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border: 1px solid #83aaa4; border-radius: 50%; background: #fff; color: #176e66; font: 700 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
.context-guide li span { display: grid; gap: 0.08rem; min-width: 0; }
.context-guide li strong { color: #294e4b; font-size: 11px; }
.context-guide li small { color: #6b7d7a; font-size: 10px; line-height: 1.45; }
.guide-reopen { display: inline-flex; align-items: center; gap: 0.3rem; margin: 0.45rem 0; padding: 0.2rem 0.4rem; border: 1px solid #c9d8d5; background: #f7faf9; color: #38635f; font-size: 10px; cursor: pointer; }
.guide-reopen span { display: grid; place-items: center; width: 1rem; height: 1rem; border-radius: 50%; background: #e4efed; color: #0d756b; font-weight: 700; }
.context-guide button:focus-visible, .guide-reopen:focus-visible { outline: 2px solid rgba(13, 117, 107, 0.3); outline-offset: 2px; }
</style>
