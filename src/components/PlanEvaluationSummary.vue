<script setup lang="ts">
import type { AgentEvaluationSummary } from '../api/endpoints'

const props = defineProps<{ summary: AgentEvaluationSummary | null | undefined; compact?: boolean }>()

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
  if (props.summary?.isLegacyUnversioned) return '历史评价口径'
  if (!props.summary?.policyCode) return '尚未生成评价'
  return `${props.summary.policyCode}@${props.summary.policyVersion || 0}`
}
</script>

<template>
  <section v-if="summary" class="plan-evaluation-summary" :class="{ compact }" aria-label="方案评价摘要">
    <header class="evaluation-summary-head">
      <div><span>方案评价</span><strong>{{ score(summary.totalScore) }}分</strong></div>
      <small>{{ policyLabel() }}</small>
    </header>
    <div class="evaluation-metrics">
      <div><span>指标满足度</span><strong>{{ score(summary.indicatorSatisfaction) }}%</strong></div>
      <div><span>共同覆盖率</span><strong>{{ ratio(summary.spatialCoverageRatio) }}</strong><small>要求 {{ ratio(summary.requiredCoverageRatio) }}</small></div>
      <div><span>时效评分</span><strong>{{ score(summary.timelinessScore) }}</strong></div>
      <div><span>资源利用率</span><strong>{{ score(summary.resourceUtilization) }}</strong></div>
      <div><span>成本评分</span><strong>{{ score(summary.costScore) }}</strong></div>
      <div><span>风险评分</span><strong>{{ score(summary.riskScore) }}</strong></div>
    </div>
    <div v-if="summary.approvalAllowed === false" class="evaluation-warning">
      <strong>当前不能确认</strong>
      <ul v-if="summary.blockingReasons?.length">
        <li v-for="reason in summary.blockingReasons" :key="reason">{{ reason }}</li>
      </ul>
      <p v-else>方案尚未满足审批条件，请先完成评价或调整资源。</p>
    </div>
  </section>
</template>

<style scoped>
.plan-evaluation-summary { display: grid; gap: .55rem; margin-top: .6rem; padding: .7rem; border: 1px solid #d8e4ee; border-radius: 11px; background: #f8fbfd; min-width: 0; }
.evaluation-summary-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }.evaluation-summary-head div { display: flex; align-items: baseline; gap: .5rem; }.evaluation-summary-head span { color: #52616d; font-size: 12px; }.evaluation-summary-head strong { color: #1e5e8c; font-size: 18px; }.evaluation-summary-head small { color: #60758a; font-size: 11px; }
.evaluation-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .35rem; }.evaluation-metrics div { min-width: 0; display: grid; gap: .08rem; padding: .4rem; border-radius: 8px; background: #fff; }.evaluation-metrics span,.evaluation-metrics small { color: #6e7e8a; font-size: 11px; }.evaluation-metrics strong { color: #293e4d; font-size: 14px; overflow-wrap: anywhere; }
.evaluation-warning { padding: .5rem .6rem; border: 1px solid #ead3a7; border-radius: 8px; background: #fff8eb; color: #76521d; font-size: 12px; line-height: 1.5; }.evaluation-warning strong { color: #8b5b0d; }.evaluation-warning ul { margin: .2rem 0 0; padding-left: 1.1rem; }.evaluation-warning p { margin: .2rem 0 0; }.compact { margin-top: .35rem; padding: .55rem; }.compact .evaluation-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 480px) { .evaluation-metrics,.compact .evaluation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .evaluation-summary-head { align-items: flex-start; flex-direction: column; } }
</style>
