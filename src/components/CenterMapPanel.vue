<script setup lang="ts">
/**
 * Lightweight status strip for centers.
 * Does NOT create a Cesium viewer — the full-screen basemap lives in AppLayout/MapBasemap.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { shellCounts, shellError, shellLoading, shellStatus } from '../gis/mapShell'

const props = withDefaults(
  defineProps<{
    center?: string
    title?: string
    compact?: boolean
  }>(),
  {
    center: 'applications',
    title: '',
    compact: true,
  },
)

const panelTitle = computed(() => props.title || '底图与业务图层')
const gisLink = computed(() => {
  if (props.center === 'data') return '/gis?tab=data'
  if (props.center === 'planning') return '/gis?tab=tasks'
  if (props.center === 'resources') return '/gis?tab=sensors'
  return '/gis'
})
</script>

<template>
  <section class="center-map-hint panel" :class="{ compact }">
    <div class="center-map-head">
      <div>
        <h2>{{ panelTitle }}</h2>
        <p class="muted">{{ shellLoading ? '图层加载中…' : shellStatus }}</p>
        <p v-if="shellError" class="error">{{ shellError }}</p>
      </div>
      <div class="center-map-actions">
        <RouterLink class="btn ghost" :to="gisLink">图层控制</RouterLink>
      </div>
    </div>
    <div class="center-map-meta muted">
      <span>传感器 {{ shellCounts.sensors }}</span>
      <span>数据 {{ shellCounts.data }}</span>
      <span>任务 {{ shellCounts.tasks }}</span>
      <span v-if="shellCounts.indicators">指标 {{ shellCounts.indicators }}</span>
      <span>全屏底图已共享</span>
    </div>
  </section>
</template>
