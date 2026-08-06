<script setup lang="ts">
import { computed } from 'vue'
import {
  stageDefinition,
  stepsForStage,
  type BusinessStageKey,
  type WorkflowStepKey,
} from '../features/businessWorkflow'

const props = withDefaults(defineProps<{
  stage: BusinessStageKey
  currentStep?: WorkflowStepKey | null
  completedSteps?: WorkflowStepKey[]
  blockedSteps?: WorkflowStepKey[]
}>(), {
  currentStep: null,
  completedSteps: () => [],
  blockedSteps: () => [],
})

const steps = computed(() => stepsForStage(props.stage))
const stageLabel = computed(() => stageDefinition(props.stage).label)
const completed = computed(() => new Set(props.completedSteps))
const blocked = computed(() => new Set(props.blockedSteps))
const activeStep = computed(() => {
  if (props.currentStep && steps.value.some((step) => step.key === props.currentStep)) return props.currentStep
  return steps.value.find((step) => !completed.value.has(step.key) && !blocked.value.has(step.key))?.key
    || [...steps.value].reverse().find((step) => completed.value.has(step.key))?.key
    || steps.value[0]?.key
})
</script>

<template>
  <section v-if="steps.length" class="stage-step-progress" aria-label="当前阶段操作步骤">
    <header>
      <strong>当前阶段</strong>
      <span>{{ stageLabel }}</span>
    </header>
    <ol>
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        :class="{
          current: activeStep === step.key,
          complete: completed.has(step.key),
          blocked: blocked.has(step.key),
        }"
        :title="step.description"
      >
        <span class="stage-step-marker" aria-hidden="true">{{ completed.has(step.key) ? '✓' : blocked.has(step.key) ? '×' : activeStep === step.key ? '●' : '○' }}</span>
        <span class="stage-step-label">{{ step.label }}</span>
        <span v-if="index < steps.length - 1" class="stage-step-arrow" aria-hidden="true">→</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.stage-step-progress {
  margin: 0 0 .65rem;
  padding: .45rem .6rem;
  border-left: 2px solid #d7e7f8;
  background: #f8fafc;
}
.stage-step-progress header {
  display: flex;
  align-items: baseline;
  gap: .35rem;
  margin-bottom: .28rem;
  color: #6e6e73;
  font-size: 10px;
}
.stage-step-progress header strong { color: #3a3a3c; font-size: 11px; }
.stage-step-progress ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.stage-step-progress li {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  color: #85868b;
  font-size: 10px;
}
.stage-step-marker { margin-right: .18rem; color: #a4a6aa; font-size: 10px; }
.stage-step-label { white-space: nowrap; }
.stage-step-arrow { margin: 0 .3rem; color: #c5c7ca; }
.stage-step-progress li.complete .stage-step-marker,
.stage-step-progress li.complete .stage-step-label { color: #2f8f5b; }
.stage-step-progress li.current .stage-step-marker,
.stage-step-progress li.current .stage-step-label { color: var(--brand); font-weight: 700; }
.stage-step-progress li.blocked .stage-step-marker,
.stage-step-progress li.blocked .stage-step-label { color: #b9bbc0; }
</style>
