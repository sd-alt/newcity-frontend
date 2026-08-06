<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BUSINESS_STAGES,
  preserveWorkflowQuery,
  routeForBusinessStage,
  type BusinessStageKey,
} from '../features/businessWorkflow'

const props = withDefaults(defineProps<{
  currentStage: BusinessStageKey
  completedStages?: BusinessStageKey[]
  blockedStages?: BusinessStageKey[]
  taskId?: number | string | null
}>(), {
  completedStages: () => [],
  blockedStages: () => [],
  taskId: null,
})

const route = useRoute()
const router = useRouter()
const completed = computed(() => new Set(props.completedStages))
const blocked = computed(() => new Set(props.blockedStages))

function navigate(stage: BusinessStageKey) {
  if (blocked.value.has(stage)) return
  const target = routeForBusinessStage(stage)
  const query = preserveWorkflowQuery(route.query as Record<string, unknown>)
  if (props.taskId != null) query.taskId = String(props.taskId)
  if (target.tab) query.tab = target.tab
  else delete query.tab
  void router.push({ path: target.path, query })
}
</script>

<template>
  <nav class="business-stage-progress" aria-label="业务阶段进度">
    <ol>
      <li
        v-for="stage in BUSINESS_STAGES"
        :key="stage.key"
        :class="{
          current: currentStage === stage.key,
          complete: completed.has(stage.key),
          blocked: blocked.has(stage.key),
        }"
      >
        <button
          type="button"
          :disabled="blocked.has(stage.key)"
          :aria-current="currentStage === stage.key ? 'step' : undefined"
          :aria-label="`${stage.label}${completed.has(stage.key) ? '，已完成' : blocked.has(stage.key) ? '，未解锁' : ''}`"
          @click="navigate(stage.key)"
        >
          <span class="business-stage-marker" aria-hidden="true">{{ completed.has(stage.key) ? '✓' : currentStage === stage.key ? '●' : '○' }}</span>
          <span class="business-stage-label">{{ stage.label }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.business-stage-progress {
  margin: .55rem 0 .65rem;
  padding: .45rem .55rem;
  border: 1px solid #e1e3e6;
  border-radius: 10px;
  background: #fff;
}
.business-stage-progress ol {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: .15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.business-stage-progress li { position: relative; min-width: 0; }
.business-stage-progress li:not(:last-child)::after {
  content: '→';
  position: absolute;
  top: 50%;
  right: -.08rem;
  color: #c4c6ca;
  font-size: 11px;
  transform: translate(50%, -50%);
}
.business-stage-progress button {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: .22rem;
  min-height: 28px;
  padding: .25rem .35rem;
  border: 0;
  background: transparent;
  color: #76777c;
  font-size: 10px;
  cursor: pointer;
}
.business-stage-progress button:hover:not(:disabled) { color: var(--brand); }
.business-stage-progress button:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.business-stage-progress button:disabled { color: #b9bbc0; cursor: not-allowed; }
.business-stage-marker { flex: 0 0 auto; color: #a0a2a7; font-size: 11px; line-height: 1; }
.business-stage-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.business-stage-progress li.complete .business-stage-marker,
.business-stage-progress li.complete .business-stage-label { color: #2f8f5b; }
.business-stage-progress li.current .business-stage-marker,
.business-stage-progress li.current .business-stage-label { color: var(--brand); font-weight: 700; }
.business-stage-progress li.blocked .business-stage-marker,
.business-stage-progress li.blocked .business-stage-label { color: #b9bbc0; }
@media (max-width: 760px) {
  .business-stage-progress { overflow-x: auto; }
  .business-stage-progress ol { min-width: 560px; }
}
</style>
