<script setup lang="ts">
import { computed } from 'vue'
import type { AgentEvaluationSummary } from '../api/endpoints'

type PlanningEvaluationSummary = {
  kind: 'planning'
  indicatorCount: number
  satisfiedCount: number
  overallSatisfied: boolean
  commonCoverageSatisfied: boolean
  commonCoveragePercent: number
  uncoveredPercent: number
  misalignmentPercent: number
  reasons: string[]
}

type EvaluationSummary = AgentEvaluationSummary | PlanningEvaluationSummary

const props = defineProps<{ summary: EvaluationSummary | null | undefined; compact?: boolean }>()

const planning = computed<PlanningEvaluationSummary | null>(() =>
  props.summary && 'kind' in props.summary && props.summary.kind === 'planning'
    ? props.summary
    : null,
)
const agent = computed<AgentEvaluationSummary | null>(() =>
  props.summary && !('kind' in props.summary)
    ? props.summary
    : null,
)

function score(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(1) : '0.0'
}

function ratio(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0.0%'
  return `${(number <= 1 ? number * 100 : number).toFixed(1)}%`
}

function policyLabel() {
  if (agent.value?.isLegacyUnversioned) return '历史评价口径'
  if (!agent.value?.policyCode) return '尚未生成评价'
  return `${agent.value.policyCode}@${agent.value.policyVersion || 0}`
}
</script>

<template>
  <section v-if="summary" class="plan-evaluation-summary" :class="{ compact, planning: Boolean(planning) }" aria-label="方案评价摘要">
    <template v-if="planning">
      <header class="evaluation-summary-head">
        <div><span>决策摘要</span><strong>{{ planning.overallSatisfied ? '满足任务' : '存在阻断' }}</strong></div>
        <small>{{ planning.commonCoverageSatisfied ? '覆盖要求已满足' : '覆盖要求未满足' }}</small>
      </header>
      <div class="evaluation-metrics evaluation-decision-metrics">
        <div><span>已满足指标</span><strong>{{ planning.satisfiedCount }} / {{ planning.indicatorCount }}</strong></div>
        <div><span>共同覆盖</span><strong>{{ planning.commonCoveragePercent }}%</strong></div>
        <div><span>未覆盖</span><strong>{{ planning.uncoveredPercent }}%</strong></div>
        <div><span>覆盖错位</span><strong>{{ planning.misalignmentPercent }}%</strong></div>
      </div>
      <div v-if="planning.reasons.length" class="evaluation-warning">
        <strong>当前阻断</strong>
        <span>{{ planning.reasons.join('；') }}</span>
      </div>
    </template>
    <template v-else>
      <header class="evaluation-summary-head">
        <div><span>方案评价</span><strong>{{ score((summary as AgentEvaluationSummary).totalScore) }}分</strong></div>
        <small>{{ policyLabel() }}</small>
      </header>
      <div class="evaluation-metrics">
        <div><span>指标满足度</span><strong>{{ score((summary as AgentEvaluationSummary).indicatorSatisfaction) }}%</strong></div>
        <div><span>共同覆盖率</span><strong>{{ ratio((summary as AgentEvaluationSummary).spatialCoverageRatio) }}</strong><small>要求 {{ ratio((summary as AgentEvaluationSummary).requiredCoverageRatio) }}</small></div>
        <div><span>时效评分</span><strong>{{ score((summary as AgentEvaluationSummary).timelinessScore) }}</strong></div>
        <div><span>资源利用率</span><strong>{{ score((summary as AgentEvaluationSummary).resourceUtilization) }}</strong></div>
        <div><span>成本评分</span><strong>{{ score((summary as AgentEvaluationSummary).costScore) }}</strong></div>
        <div><span>风险评分</span><strong>{{ score((summary as AgentEvaluationSummary).riskScore) }}</strong></div>
      </div>
      <div v-if="(summary as AgentEvaluationSummary).approvalAllowed === false" class="evaluation-warning">
        <strong>当前不能确认</strong>
        <ul v-if="(summary as AgentEvaluationSummary).blockingReasons?.length">
          <li v-for="reason in (summary as AgentEvaluationSummary).blockingReasons" :key="reason">{{ reason }}</li>
        </ul>
        <p v-else>方案尚未满足审批条件，请先完成评价或调整资源。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plan-evaluation-summary { display: grid; gap: .55rem; margin-top: .6rem; padding: .7rem; border: 1px solid #d8e4ee; border-radius: 11px; background: #f8fbfd; min-width: 0; }
.evaluation-summary-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }.evaluation-summary-head div { display: flex; align-items: baseline; gap: .5rem; }.evaluation-summary-head span { color: #52616d; font-size: 12px; }.evaluation-summary-head strong { color: #1e5e8c; font-size: 18px; }.evaluation-summary-head small { color: #60758a; font-size: 11px; }
.evaluation-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .35rem; }.evaluation-metrics div { min-width: 0; display: grid; gap: .08rem; padding: .4rem; border-radius: 8px; background: #fff; }.evaluation-metrics span,.evaluation-metrics small { color: #6e7e8a; font-size: 11px; }.evaluation-metrics strong { color: #293e4d; font-size: 14px; overflow-wrap: anywhere; }
.evaluation-warning { display: grid; gap: .18rem; padding: .5rem .6rem; border: 1px solid #ead3a7; border-radius: 8px; background: #fff8eb; color: #76521d; font-size: 12px; line-height: 1.5; }.evaluation-warning strong { color: #8b5b0d; }.evaluation-warning ul { margin: .2rem 0 0; padding-left: 1.1rem; }.evaluation-warning p { margin: .2rem 0 0; }.compact { margin-top: .35rem; padding: .55rem; }.compact .evaluation-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.plan-evaluation-summary.planning { margin-top: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }.planning .evaluation-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }.planning .evaluation-metrics div { border: 1px solid #e1e3e6; border-radius: 8px; background: #f8fafc; }.planning .evaluation-summary-head strong { font-size: 16px; }.planning .evaluation-warning { border-left-width: 3px; }
@media (max-width: 480px) { .evaluation-metrics,.compact .evaluation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .evaluation-summary-head { align-items: flex-start; flex-direction: column; } }
</style>
