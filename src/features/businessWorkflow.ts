export type BusinessStageKey =
  | 'demand'
  | 'resource_selection'
  | 'capability_evaluation'
  | 'resource_configuration'
  | 'plan_management'
  | 'execution_trace'

export type WorkflowStepKey =
  | 'task_create'
  | 'task_submit'
  | 'requirement_reverse'
  | 'candidate_scoring'
  | 'capability_compare'
  | 'coverage_precheck'
  | 'basic_plan_validation'
  | 'basic_association'
  | 'optimized_association'
  | 'supplement_association'
  | 'satisfaction_evaluation'
  | 'planning_output'
  | 'plan_approval'
  | 'plan_publish'
  | 'execution_start'
  | 'execution_monitor'
  | 'exception_handling'
  | 'result_view'

export type LegacyStepKey =
  | 'create'
  | 'submit'
  | 'reverse'
  | 'candidates'
  | 'basic'
  | 'optimize'
  | 'supplement'
  | 'evaluate'
  | 'output'

export type WorkflowRoute = {
  path: '/business' | '/business/execution'
  tab?: 'tasks' | 'candidates' | 'evaluation' | 'flow' | 'plans'
}

export type BusinessStageDefinition = {
  key: BusinessStageKey
  label: string
  shortLabel: string
  route: WorkflowRoute
}

export type WorkflowStepDefinition = {
  key: WorkflowStepKey
  stage: BusinessStageKey
  label: string
  description: string
  route: WorkflowRoute
  legacyKey?: LegacyStepKey
}

export const BUSINESS_STAGES: BusinessStageDefinition[] = [
  { key: 'demand', label: '需求查询', shortLabel: '需求', route: { path: '/business', tab: 'tasks' } },
  { key: 'resource_selection', label: '资源选择', shortLabel: '资源', route: { path: '/business', tab: 'candidates' } },
  { key: 'capability_evaluation', label: '能力评估', shortLabel: '评估', route: { path: '/business', tab: 'evaluation' } },
  { key: 'resource_configuration', label: '资源配置', shortLabel: '配置', route: { path: '/business', tab: 'flow' } },
  { key: 'plan_management', label: '方案管理', shortLabel: '方案', route: { path: '/business', tab: 'plans' } },
  { key: 'execution_trace', label: '过程管理与成果追溯', shortLabel: '追溯', route: { path: '/business/execution' } },
]

export const WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  { key: 'task_create', stage: 'demand', label: '创建任务', description: '建立观测任务与目标', route: { path: '/business', tab: 'tasks' }, legacyKey: 'create' },
  { key: 'task_submit', stage: 'demand', label: '提交任务', description: '确认任务进入处理流程', route: { path: '/business', tab: 'tasks' }, legacyKey: 'submit' },
  { key: 'requirement_reverse', stage: 'resource_selection', label: '需求反算', description: '反算所需资源类型与数量', route: { path: '/business', tab: 'candidates' }, legacyKey: 'reverse' },
  { key: 'candidate_scoring', stage: 'resource_selection', label: '候选与评分', description: '筛选候选资源并查看评分依据', route: { path: '/business', tab: 'candidates' }, legacyKey: 'candidates' },
  { key: 'capability_compare', stage: 'capability_evaluation', label: '候选能力对比', description: '比较候选资源的观测能力', route: { path: '/business', tab: 'evaluation' } },
  { key: 'coverage_precheck', stage: 'capability_evaluation', label: '覆盖预评估', description: '预览覆盖能力与约束满足度', route: { path: '/business', tab: 'evaluation' } },
  { key: 'basic_plan_validation', stage: 'capability_evaluation', label: '基础方案校验', description: '确认资源组合可以进入配置', route: { path: '/business', tab: 'evaluation' } },
  { key: 'basic_association', stage: 'resource_configuration', label: '基础关联', description: '建立初步资源关联', route: { path: '/business', tab: 'flow' }, legacyKey: 'basic' },
  { key: 'optimized_association', stage: 'resource_configuration', label: '优化关联', description: '优化资源组合与覆盖范围', route: { path: '/business', tab: 'flow' }, legacyKey: 'optimize' },
  { key: 'supplement_association', stage: 'resource_configuration', label: '增补关联', description: '补足覆盖不足与空间缺口', route: { path: '/business', tab: 'flow' }, legacyKey: 'supplement' },
  { key: 'satisfaction_evaluation', stage: 'plan_management', label: '满足度评估', description: '核查覆盖、精度与任务满足度', route: { path: '/business', tab: 'plans' }, legacyKey: 'evaluate' },
  { key: 'planning_output', stage: 'plan_management', label: '规划输出', description: '生成可审核的规划方案', route: { path: '/business', tab: 'plans' }, legacyKey: 'output' },
  { key: 'plan_approval', stage: 'plan_management', label: '方案审核', description: '确认方案内容与版本', route: { path: '/business', tab: 'plans' } },
  { key: 'plan_publish', stage: 'plan_management', label: '方案发布', description: '发布可执行方案', route: { path: '/business', tab: 'plans' } },
  { key: 'execution_start', stage: 'execution_trace', label: '执行启动', description: '按已发布方案下发执行', route: { path: '/business/execution' } },
  { key: 'execution_monitor', stage: 'execution_trace', label: '执行监控', description: '查看执行进度与运行状态', route: { path: '/business/execution' } },
  { key: 'exception_handling', stage: 'execution_trace', label: '异常处理', description: '处理失败、暂停与重试', route: { path: '/business/execution' } },
  { key: 'result_view', stage: 'execution_trace', label: '成果查看', description: '汇集成果并保留追溯记录', route: { path: '/business/execution' } },
]

const LEGACY_STEP_MAP: Record<LegacyStepKey, WorkflowStepKey> = {
  create: 'task_create',
  submit: 'task_submit',
  reverse: 'requirement_reverse',
  candidates: 'candidate_scoring',
  basic: 'basic_association',
  optimize: 'optimized_association',
  supplement: 'supplement_association',
  evaluate: 'satisfaction_evaluation',
  output: 'planning_output',
}

export const WORKFLOW_CONTEXT_KEYS = ['taskId', 'planId', 'runId', 'demandId', 'returnTo', 'currentTab'] as const

export function workflowStepForLegacy(step: LegacyStepKey): WorkflowStepDefinition {
  return WORKFLOW_STEPS.find((item) => item.key === LEGACY_STEP_MAP[step]) || WORKFLOW_STEPS[0]!
}

export function stageForBusinessTab(tab: string): BusinessStageKey {
  if (tab === 'candidates') return 'resource_selection'
  if (tab === 'evaluation') return 'capability_evaluation'
  if (tab === 'flow') return 'resource_configuration'
  if (tab === 'plans') return 'plan_management'
  if (tab === 'execution') return 'execution_trace'
  return 'demand'
}

export function stageDefinition(stage: BusinessStageKey): BusinessStageDefinition {
  return BUSINESS_STAGES.find((item) => item.key === stage) || BUSINESS_STAGES[0]!
}

export function stepsForStage(stage: BusinessStageKey): WorkflowStepDefinition[] {
  return WORKFLOW_STEPS.filter((item) => item.stage === stage)
}

export function routeForLegacyStep(step: LegacyStepKey): WorkflowRoute {
  return workflowStepForLegacy(step).route
}

export function routeForBusinessStage(stage: BusinessStageKey): WorkflowRoute {
  return stageDefinition(stage).route
}

export function preserveWorkflowQuery(query: Record<string, unknown>, includeTab = true): Record<string, string> {
  const next: Record<string, string> = {}
  for (const key of WORKFLOW_CONTEXT_KEYS) {
    const value = query[key]
    if (value == null || Array.isArray(value)) {
      if (Array.isArray(value) && value[0] != null) next[key] = String(value[0])
      continue
    }
    next[key] = String(value)
  }
  if (!includeTab) delete next.currentTab
  return next
}
