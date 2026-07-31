<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  page: number
  pages: string[]
  kind?: 'sections' | 'records'
  label?: string
  summary?: string
  previousLabel?: string
  nextLabel?: string
}>(), {
  kind: 'sections',
  label: '卡片分页',
  summary: '',
  previousLabel: '上一项',
  nextLabel: '下一项',
})

const emit = defineEmits<{ 'update:page': [page: number] }>()
const pageCount = computed(() => Math.max(1, props.pages.length))
const currentPage = computed(() => Math.min(pageCount.value, Math.max(1, props.page)))
const currentTitle = computed(() => props.pages[currentPage.value - 1] || `第 ${currentPage.value} 页`)
const showPager = computed(() => props.kind === 'records'
  ? Boolean(props.summary || props.pages.length > 1)
  : props.pages.length > 1)

function go(page: number) {
  const next = Math.min(pageCount.value, Math.max(1, page))
  if (next !== currentPage.value) emit('update:page', next)
}

function selectPage(event: Event) {
  go(Number((event.target as HTMLSelectElement).value))
}
</script>

<template>
  <nav v-if="showPager" class="card-pager" :class="`is-${kind}`" :aria-label="label">
    <template v-if="kind === 'records'">
      <span class="record-pager-total">{{ summary }}</span>
      <div v-if="pageCount > 1" class="record-pager-controls">
        <button type="button" class="record-pager-nav" aria-label="上一页" title="上一页" :disabled="currentPage <= 1" @click="go(currentPage - 1)">
          <span aria-hidden="true">‹</span>
        </button>
        <label class="record-pager-position">
          <span class="sr-only">选择页码</span>
          <select :value="currentPage" :disabled="pageCount <= 1" :title="currentTitle" @change="selectPage">
            <option v-for="(title, index) in pages" :key="`${index}-${title}`" :value="index + 1">{{ index + 1 }}</option>
          </select>
          <span>/ {{ pageCount }} 页</span>
        </label>
        <button type="button" class="record-pager-nav" aria-label="下一页" title="下一页" :disabled="currentPage >= pageCount" @click="go(currentPage + 1)">
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </template>
    <template v-else>
      <button type="button" class="section-pager-nav" :disabled="currentPage <= 1" @click="go(currentPage - 1)">
        <span aria-hidden="true">‹</span><span>{{ previousLabel }}</span>
      </button>
      <label class="section-pager-current">
        <small>{{ currentPage }} / {{ pageCount }}</small>
        <select :value="currentPage" :aria-label="`${label}：选择内容`" :title="currentTitle" @change="selectPage">
          <option v-for="(title, index) in pages" :key="`${index}-${title}`" :value="index + 1">{{ title }}</option>
        </select>
      </label>
      <button type="button" class="section-pager-nav" :disabled="currentPage >= pageCount" @click="go(currentPage + 1)">
        <span>{{ nextLabel }}</span><span aria-hidden="true">›</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.card-pager { margin-top: .6rem; padding-top: .55rem; border-top: 1px solid #eceef1; }
.card-pager.is-records { display: flex; align-items: center; justify-content: space-between; gap: .55rem; min-height: 32px; }
.record-pager-total { color: #68686d; font-size: 10px; white-space: nowrap; }
.record-pager-controls { display: inline-flex; align-items: center; gap: 6px; }
.record-pager-nav { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #d2d2d7; border-radius: 8px; background: #fff; color: #3a3a3c; font: 600 16px/1 inherit; cursor: pointer; }
.record-pager-position { display: inline-flex; align-items: center; gap: 4px; color: #68686d; font-size: 10px; white-space: nowrap; }
.record-pager-position select { width: 46px; height: 30px; padding: 0 18px 0 8px; border: 1px solid #d2d2d7; border-radius: 8px; background: #fff; color: #3a3a3c; font-size: 10px; }
.card-pager.is-sections { display: grid; grid-template-columns: 64px minmax(0, 1fr) 64px; align-items: end; gap: 6px; }
.section-pager-nav { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-height: 34px; padding: .3rem .4rem; border: 1px solid #d2d2d7; border-radius: 8px; background: #fff; color: #3a3a3c; font: 500 10px/1.2 inherit; cursor: pointer; white-space: nowrap; }
.section-pager-current { display: grid; gap: 2px; min-width: 0; }
.section-pager-current small { color: #86868b; font-size: 9px; line-height: 1; text-align: center; }
.section-pager-current select { width: 100%; min-width: 0; height: 34px; padding: 0 24px 0 9px; border: 1px solid #d2d2d7; border-radius: 8px; background: #fff; color: #3a3a3c; font-size: 10px; font-weight: 600; text-overflow: ellipsis; }
.card-pager :is(.record-pager-nav, .section-pager-nav):hover:not(:disabled) { border-color: #b7d7f7; background: #f0f7ff; color: #0071e3; }
.card-pager :is(.record-pager-nav, .section-pager-nav):disabled { background: #f5f5f7; color: #c7c7cc; cursor: not-allowed; }
.card-pager :is(button):focus-visible { outline: 3px solid rgba(0, 113, 227, .18); outline-offset: 1px; }
.card-pager select:focus-visible { outline: 3px solid rgba(0, 113, 227, .18); outline-offset: 1px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
