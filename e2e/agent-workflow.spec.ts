import { test, expect, type Page } from '@playwright/test'

async function mockAgentRun(page: Page, runId: string, run: Record<string, any>) {
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route(`**/api/agent/runs/${runId}/**`, async (route) => route.fulfill({ json: { data: run } }))
}

function focusActionRun(runId: string, status: string, currentStage: string, action: Record<string, any>, approvals: Record<string, any>[] = [], executionControl: Record<string, any> = {}) {
  const checkpointId = 'focus-checkpoint'
  return {
    id: runId,
    status,
    currentStage,
    progress: 40,
    workflow: {
      name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '聚焦人工动作', graphVersion: 1,
      checkpointId, status, fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0,
      nodes: [{ nodeId: currentStage, nodeType: currentStage, code: currentStage, name: currentStage, status, mandatory: true, riskLevel: 'high', planningReason: '', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [],
    },
    currentAction: action,
    pendingApprovals: approvals.map((item) => ({ checkpointId, status: 'pending', ...item })),
    executionControl,
    toolCalls: [], artifacts: [], modelCalls: [], demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试人工动作定位', structuredRequirement: {} },
  }
}

test('Agent 工作台展示独立的规划图和执行图', async ({ page }) => {
  const planningNodes = [
    ['requirement', '需求理解'], ['classification', '任务分类'], ['graph_planning', '图规划'], ['validation', '图校验'],
  ].map(([nodeId, name], index) => ({ nodeId, nodeType: nodeId, code: nodeId, name, status: 'completed', mandatory: true, riskLevel: 'low', planningReason: '真实规划节点', topologicalLevel: index, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }))
  const workflow = {
    name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'resource_query', goal: '执行图', graphVersion: 1,
    checkpointId: '', status: 'completed', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0,
    nodes: [{ nodeId: 'task_completed', nodeType: 'task_completed', code: 'task_completed', name: '任务完成', status: 'completed', mandatory: true, riskLevel: 'medium', planningReason: '', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: { result: { summary: '完整观测任务成果已生成' } }, errorMessage: '' }], edges: [],
  }
  const run = {
    id: '00000000-0000-0000-0000-000000000001', status: 'completed', currentStage: 'task_completed', progress: 100,
    workflow, planningWorkflow: { ...workflow, name: 'planning', graphType: 'planning', goal: '将自然语言需求转换为经过校验的 TaskGraphSpec', nodeCount: 4, edgeCount: 3, nodes: planningNodes },
    pendingApprovals: [], toolCalls: [], artifacts: [], demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试动态任务图', structuredRequirement: {} },
  }

  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route('**/api/agent/runs/00000000-0000-0000-0000-000000000001/**', async (route) => route.fulfill({ json: { data: run } }))

  await page.goto('/application/tasks?runId=00000000-0000-0000-0000-000000000001')
  await page.getByRole('button', { name: '任务图' }).dispatchEvent('click')
  await expect(page.locator('[aria-label="任务规划"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('需求理解 → 任务分类 → 图规划 → 图校验')).toBeVisible()
  await expect(page.getByLabel('按依赖层级排列的任务图').getByText('任务完成')).toBeVisible()
  await page.getByRole('button', { name: '结果', exact: true }).dispatchEvent('click')
  await expect(page.getByLabel('最终业务结果')).toContainText('完整观测任务成果已生成')
})

test('执行异常只展示结构化处置，不展示普通补充输入', async ({ page }) => {
  const run = {
    id: '00000000-0000-0000-0000-000000000002', status: 'waiting_input', currentStage: 'execution_active_monitor', progress: 70,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '执行图', graphVersion: 1, checkpointId: 'checkpoint-2', status: 'waiting_input', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'execution_active_monitor', nodeType: 'execution_active_monitor', code: 'execution_active_monitor', name: '执行主动监控', status: 'waiting_input', mandatory: true, riskLevel: 'high', planningReason: '监控执行状态', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [{ id: 7, type: 'execution_intervention', title: '执行异常需要人工处理', description: '存在执行失败的执行项，请选择重试、转人工或取消。', status: 'pending', checkpointId: 'checkpoint-2', payload: { executionItems: [{ id: 9, name: '雨量观测', status: 'failed', progress: 50, retryCount: 0, errorMessage: '接口超时', availableActions: ['retry', 'manual', 'cancel'] }] } }],
    toolCalls: [], artifacts: [], modelCalls: [], executionControl: {}, demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试执行异常', structuredRequirement: {} },
  }
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route('**/api/agent/runs/00000000-0000-0000-0000-000000000002/**', async (route) => route.fulfill({ json: { data: run } }))

  await page.goto('/application/tasks?runId=00000000-0000-0000-0000-000000000002')
  await expect(page.getByText('执行异常需要人工处置')).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' }).first()).toBeVisible()
  await expect(page.getByText('补充需求信息')).toHaveCount(0)
})

test('方案资源选择不会默认选中旧资源和候选资源', async ({ page }) => {
  const run = {
    id: '00000000-0000-0000-0000-000000000003', status: 'waiting_input', currentStage: 'update_existing_plan', progress: 55,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'plan_adjustment', goal: '调整图', graphVersion: 1, checkpointId: 'checkpoint-3', status: 'waiting_input', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'update_existing_plan', nodeType: 'update_existing_plan', code: 'update_existing_plan', name: '更新观测方案', status: 'waiting_input', mandatory: true, riskLevel: 'high', planningReason: '等待人工选择资源', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [{ id: 8, type: 'plan_resource_selection', title: '请选择替代资源', description: '必须明确旧资源和新资源。', status: 'pending', checkpointId: 'checkpoint-3', payload: { planId: 1, planVersion: 4, existingResources: [{ id: 12, resourceType: 'sensor', resourceId: 101, resourceName: '旧雨量传感器' }], candidates: [{ id: 205, name: '新雨量传感器', matched: true }] } }],
    toolCalls: [], artifacts: [], modelCalls: [], executionControl: {}, demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试方案调整', structuredRequirement: {} },
    planVersion: 4,
  }
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route('**/api/agent/runs/00000000-0000-0000-0000-000000000003/**', async (route) => route.fulfill({ json: { data: run } }))

  await page.goto('/application/tasks?runId=00000000-0000-0000-0000-000000000003')
  const selects = page.locator('.plan-selection-card select')
  await expect(selects).toHaveCount(2)
  await expect(selects.nth(0)).toHaveValue('')
  await expect(selects.nth(1)).toHaveValue('')
  await expect(page.locator('.plan-selection-card textarea')).toHaveValue('')
  await expect(page.getByText('补充需求信息')).toHaveCount(0)
})

test('人工完成按钮提交期间禁用并阻止重复请求', async ({ page }) => {
  const runId = '00000000-0000-0000-0000-000000000004'
  const run = {
    id: runId, status: 'manual_required', currentStage: 'execution_active_monitor', progress: 70,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '执行图', graphVersion: 1, checkpointId: 'checkpoint-4', status: 'manual_required', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'execution_active_monitor', nodeType: 'execution_active_monitor', code: 'execution_active_monitor', name: '执行主动监控', status: 'completed', mandatory: true, riskLevel: 'high', planningReason: '监控执行状态', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [], toolCalls: [], artifacts: [], modelCalls: [],
    executionControl: { action: 'manual', executionItems: [{ id: 15, executionItemId: 15, name: '人工雨量观测', status: 'manual_intervention', progress: 50, retryCount: 0 }] },
    demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试人工完成幂等', structuredRequirement: {} },
  }
  let submitCount = 0
  let releaseManualRequest: (() => void) | undefined
  const manualRequestPending = new Promise<void>((resolve) => { releaseManualRequest = resolve })
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route(`**/api/agent/runs/${runId}/**`, async (route) => {
    if (route.request().url().includes('/manual-complete/')) {
      submitCount += 1
      // 由测试显式释放响应，稳定验证请求处理期间的按钮状态。
      await manualRequestPending
      await route.fulfill({ json: { data: { ...run, status: 'queued', executionControl: { ...run.executionControl, action: 'manual_complete' } } } })
      return
    }
    await route.fulfill({ json: { data: run } })
  })

  await page.goto(`/application/tasks?runId=${runId}`)
  // 使用稳定容器定位，按钮文案在提交后会变为“正在提交”。
  const button = page.locator('.execution-intervention-card .execution-actions button')
  await expect(button).toBeEnabled()
  await button.click()
  await expect.poll(() => submitCount).toBe(1)
  await expect(button).toBeDisabled()
  await expect(button).toHaveText('正在提交')
  await button.click({ force: true })
  await expect.poll(() => submitCount).toBe(1)
  releaseManualRequest?.()
})

test('Checkpoint绑定前禁用审批并在绑定后自动解锁', async ({ page }) => {
  const runId = '00000000-0000-0000-0000-000000000005'
  const baseRun = {
    id: runId, status: 'waiting_approval', currentStage: 'indicator_confirmation', progress: 20,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '执行图', graphVersion: 1, checkpointId: '', status: 'waiting_approval', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'indicator_confirmation', nodeType: 'indicator_confirmation', code: 'indicator_confirmation', name: '指标确认', status: 'waiting_approval', mandatory: true, riskLevel: 'high', planningReason: '等待人工确认', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [{ id: 10, type: 'indicator_confirmation', title: '确认任务指标', description: '请确认指标体系后继续。', status: 'pending', checkpointId: '', payload: {} }],
    toolCalls: [], artifacts: [], modelCalls: [], executionControl: {}, demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试检查点准备状态', structuredRequirement: {} },
  }
  const readyRun = {
    ...baseRun,
    workflow: { ...baseRun.workflow, checkpointId: 'checkpoint-5' },
    pendingApprovals: [{ ...baseRun.pendingApprovals[0], checkpointId: 'checkpoint-5' }],
  }
  let detailCount = 0
  let releaseEvents: (() => void) | undefined
  const eventsPending = new Promise<void>((resolve) => { releaseEvents = resolve })
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route(`**/api/agent/runs/${runId}/**`, async (route) => {
    if (route.request().url().includes('/events/')) {
      await eventsPending
      await route.fulfill({ status: 503, body: '' })
      return
    }
    detailCount += 1
    await route.fulfill({ json: { data: detailCount === 1 ? baseRun : readyRun } })
  })

  await page.goto(`/application/tasks?runId=${runId}`)
  const approveButton = page.getByRole('button', { name: '确认并继续' })
  await expect(page.getByText('正在保存工作流检查点')).toBeVisible()
  await expect(approveButton).toBeDisabled()
  releaseEvents?.()
  await expect(approveButton).toBeEnabled({ timeout: 10_000 })
  await expect.poll(() => detailCount).toBeGreaterThanOrEqual(2)
})

test('需求补充只展示消息输入而不展示普通审批按钮', async ({ page }) => {
  const runId = '00000000-0000-0000-0000-000000000006'
  const run = {
    id: runId, status: 'waiting_input', currentStage: 'completeness_check', progress: 10,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '执行图', graphVersion: 1, checkpointId: 'checkpoint-6', status: 'waiting_input', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'completeness_check', nodeType: 'completeness_check', code: 'completeness_check', name: '完整性检查', status: 'waiting_input', mandatory: true, riskLevel: 'medium', planningReason: '等待补充需求', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [{ id: 11, type: 'requirement_clarification', title: '补充监测需求', description: '请补充监测时间。', status: 'pending', checkpointId: 'checkpoint-6', payload: { missingFields: ['监测时间'] } }],
    toolCalls: [], artifacts: [], modelCalls: [], executionControl: {}, demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试需求补充入口', structuredRequirement: {} },
  }
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route(`**/api/agent/runs/${runId}/**`, async (route) => route.fulfill({ json: { data: run } }))

  await page.goto(`/application/tasks?runId=${runId}`)
  await expect(page.getByText('补充需求信息')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交并重新分析' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '确认并继续' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '拒绝' })).toHaveCount(0)
})

test('Checkpoint故障提供重新绑定和最后有效检查点重试入口', async ({ page }) => {
  const runId = '00000000-0000-0000-0000-000000000007'
  const run = {
    id: runId, status: 'manual_required', currentStage: 'plan_confirmation', progress: 55,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', checkpointId: 'checkpoint-valid', status: 'manual_required', nodes: [], edges: [] },
    pendingApprovals: [], toolCalls: [], artifacts: [], modelCalls: [],
    executionControl: { action: 'checkpoint_error', manualReasonCode: 'checkpoint_error', message: '工作流检查点绑定失败，请选择恢复方式。' },
    demand: { id: 1, sceneName: '测试场景', originalRequirement: '测试检查点恢复', structuredRequirement: {} },
  }
  const actions: string[] = []
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ json: { data: { csrfToken: 'test' } } }))
  await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } }))
  await page.route('**/api/v1/association/scenes', async (route) => route.fulfill({ json: { data: [{ id: 1, name: '测试场景' }] } }))
  await page.route(`**/api/agent/runs/${runId}/**`, async (route) => {
    if (route.request().method() === 'POST') {
      actions.push(route.request().url().includes('/rebind-checkpoint/') ? 'rebind' : 'retry')
    }
    await route.fulfill({ json: { data: run } })
  })

  await page.goto(`/application/tasks?runId=${runId}`)
  const retry = page.getByRole('button', { name: '尝试恢复任务' })
  await retry.dispatchEvent('click')
  await expect.poll(() => actions).toContain('retry')
  await page.getByText('更多').click({ force: true })
  const rebind = page.getByRole('button', { name: '重新绑定恢复点' })
  await expect(rebind).toBeVisible()
  await rebind.click()
  await expect.poll(() => actions).toContain('rebind')
})

test('从不同工作台页进入人工动作时恢复概览并聚焦对应表单', async ({ page }) => {
  const cases = [
    {
      id: 'focus-requirement', tab: '任务图', status: 'waiting_input', stage: 'completeness_check',
      action: { type: 'requirement_clarification', title: '补充监测需求', description: '请补充监测条件。', severity: 'warning', primaryAction: { key: 'open', label: '补充需求' }, secondaryActions: [] },
      approvals: [{ id: 21, type: 'requirement_clarification', title: '补充监测需求', description: '请补充监测时间。', payload: { missingFields: ['监测时间'] } }],
      focus: page.locator('textarea[placeholder="补充缺失的区域、时间、目标或约束"]'),
    },
    {
      id: 'focus-ordinary', tab: '结果', status: 'waiting_approval', stage: 'indicator_confirmation',
      action: { type: 'indicator_confirmation', title: '确认任务指标', description: '请确认指标。', severity: 'warning', primaryAction: { key: 'open', label: '确认指标' }, secondaryActions: [] },
      approvals: [{ id: 22, type: 'indicator_confirmation', title: '确认任务指标', description: '请确认指标体系。', payload: {} }],
      focus: page.locator('.approval-stack .btn.primary'),
    },
    {
      id: 'focus-plan', tab: '技术记录', status: 'waiting_input', stage: 'update_existing_plan',
      action: { type: 'plan_resource_selection', title: '选择替代资源', description: '请明确替代资源。', severity: 'warning', primaryAction: { key: 'open', label: '选择资源' }, secondaryActions: [] },
      approvals: [{ id: 23, type: 'plan_resource_selection', title: '选择替代资源', description: '请选择新的传感器。', payload: { planId: 1, planVersion: 2, existingResources: [{ id: 12, resourceId: 101, resourceName: '旧资源' }], candidates: [{ id: 205, resourceId: 205, name: '新资源', matched: true }] } }],
      focus: page.locator('.plan-selection-card select').first(),
    },
    {
      id: 'focus-execution', tab: '任务图', status: 'waiting_input', stage: 'execution_active_monitor',
      action: { type: 'execution_intervention', title: '处理执行异常', description: '请处理执行项。', severity: 'warning', primaryAction: { key: 'open', label: '处理异常' }, secondaryActions: [] },
      approvals: [{ id: 24, type: 'execution_intervention', title: '处理执行异常', description: '执行项失败。', payload: { executionItems: [{ id: 9, name: '雨量观测', status: 'failed', availableActions: ['retry'] }] } }],
      focus: page.locator('.execution-intervention-card textarea').first(),
    },
    {
      id: 'focus-manual', tab: '结果', status: 'manual_required', stage: 'execution_active_monitor',
      action: { type: 'manual_execution', title: '提交人工执行结果', description: '请填写人工结果。', severity: 'warning', primaryAction: { key: 'manual-complete', label: '填写人工结果' }, secondaryActions: [] },
      approvals: [], executionControl: { action: 'manual', executionItems: [{ id: 15, executionItemId: 15, name: '人工观测', status: 'manual_intervention', progress: 50 }] },
      focus: page.locator('.execution-intervention-card textarea').first(),
    },
  ]

  for (const item of cases) {
    const run = focusActionRun(item.id, item.status, item.stage, item.action, item.approvals, item.executionControl)
    await mockAgentRun(page, item.id, run)
    await page.goto(`/application/tasks?runId=${item.id}`)
    await page.getByRole('button', { name: item.tab, exact: true }).dispatchEvent('click')
    await page.getByRole('region', { name: '当前需要处理的事项' }).getByRole('button', { name: item.action.primaryAction.label }).dispatchEvent('click')
    await expect(item.focus).toBeFocused()
  }
})

test('传感器档案按查询参数定位观测能力并提交结构化量测项', async ({ page }) => {
  let patchBody: Record<string, any> | null = null
  const detail = {
    id: 1,
    name: '雨量传感器',
    type: '气象传感器',
    platformName: '示范平台',
    platformStatus: 'active',
    general: { name: '示范平台', sensorName: '雨量传感器', identifier: 'RAIN-001', status: 'active' },
    attributes: { capability: { principle: '翻斗计量', parameters: {} }, spatialResolutionM: 10, temporalResolutionSeconds: 60, accuracyPercent: 95, reliabilityPercent: 98, classification: 'meteorology', keywords: '' },
    measurementItems: [],
    profileCompleteness: { completedCount: 2, totalCount: 8, ratio: 0.25, sections: [] },
    spatiotemporal: {}, geographic: {}, history: [], contact: {}, constraints: {}, interfaces: [],
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ json: { data: { csrfToken: 'test' } } })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } })
    if (url.pathname.endsWith('/observations/sensors') && request.method() === 'GET') return route.fulfill({ json: { data: [{ id: 1, name: '雨量传感器', sensorName: '雨量传感器', platformId: 11, platformName: '示范平台', platformStatus: 'active' }] } })
    if (url.pathname.endsWith('/resource/sensors/1/octuple') && request.method() === 'GET') return route.fulfill({ json: { data: detail } })
    if (url.pathname.endsWith('/resource/sensors/1/octuple') && request.method() === 'PATCH') {
      patchBody = JSON.parse(request.postData() || '{}')
      return route.fulfill({ json: { data: { ...detail, attributes: patchBody.attributes || detail.attributes, measurementItems: patchBody.attributes?.measurementItems || detail.measurementItems } } })
    }
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto('/resources/sensors?tab=capabilities&sensorId=1&section=attributes&mode=edit')
  await expect(page.getByRole('heading', { name: '传感器观测能力' })).toBeVisible()
  await page.getByRole('button', { name: '新增量测项' }).click()
  const editor = page.locator('.inline-editor')
  await editor.getByLabel('编码').fill('rainfall')
  await editor.getByLabel('名称').fill('降雨量')
  await editor.getByLabel('单位').fill('mm')
  await editor.getByRole('button', { name: '保存量测项' }).click()
  await page.getByRole('button', { name: '保存传感器观测能力' }).click()
  await expect(page.getByText('传感器观测能力已保存')).toBeVisible()
  expect(patchBody?.attributes?.capability?.principle).toBe('翻斗计量')
  expect(patchBody?.attributes?.measurementItems?.[0]).toMatchObject({ code: 'rainfall', name: '降雨量', unit: 'mm' })
  expect(patchBody?.attributes?.capabilityText).toBeUndefined()
})

test('四中心二级导航统一无编号并保留既有路由和 Tab', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ json: { data: { csrfToken: 'test' } } })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } })
    if (url.pathname.endsWith('/planning/tasks/42')) return route.fulfill({ json: { data: { id: 42, name: '暴雨观测', code: 'TASK-42', status: 'submitted', observationTarget: '验证深链不会改写阶段' } } })
    if (url.pathname.endsWith('/planning/tasks')) return route.fulfill({ json: { data: [{ id: 42, name: '暴雨观测', code: 'TASK-42', status: 'submitted', observationTarget: '验证深链不会改写阶段' }] } })
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto('/business?tab=tasks&taskId=42')
  await expect(page).toHaveURL(/\/business\?tab=tasks&taskId=42/)
  await expect(page.getByRole('heading', { name: '任务列表' })).toBeVisible()
  await expect(page.locator('.business-stage-progress .business-stage-label')).toHaveText([
    '需求查询',
    '资源选择',
    '能力评估',
    '资源配置',
    '方案管理',
    '过程管理与成果追溯',
  ])
  await expect(page.locator('.stage-step-progress .stage-step-label')).toHaveText(['创建任务', '提交任务'])
  await expect(page.locator('.business-route')).toHaveCount(0)
  const businessNavigation = page.locator('.rail-subnav').filter({ hasText: '需求查询' })
  await expect(businessNavigation.locator('.rail-subitem')).toHaveCount(6)
  await expect(businessNavigation.locator('.rail-stage')).toHaveCount(0)
  await expect(businessNavigation.locator('.rail-subitem--staged')).toHaveCount(0)
  await expect(businessNavigation.locator('.rail-subitem-label')).toHaveText([
    '需求查询',
    '资源选择',
    '能力评估',
    '资源配置',
    '方案管理',
    '过程管理与成果追溯',
  ])
  await expect(businessNavigation).toHaveCSS('border-left-width', '1px')
  await expect(businessNavigation).toHaveCSS('border-left-style', 'solid')
  await expect(businessNavigation.locator('.rail-subitem').first()).toHaveCSS('min-height', '30px')
  await expect(businessNavigation.locator('.rail-subitem').first()).toHaveCSS('font-size', '11px')
  await expect(businessNavigation.locator('.rail-subitem').first()).toHaveCSS('border-radius', '10px')

  await businessNavigation.getByRole('button', { name: '资源选择', exact: true }).click()
  await expect(page).toHaveURL(/\/business\?tab=candidates&taskId=42/)
  await expect(page.locator('.stage-step-progress .stage-step-label')).toHaveText(['需求反算', '候选与评分'])
  await page.goto('/business?tab=flow&taskId=42&demandId=7&returnTo=%2Fbusiness%3Ftab%3Dtasks')
  await expect(page).toHaveURL(/\/business\?tab=flow&taskId=42&demandId=7&returnTo=/)
  await expect(page.locator('.stage-step-progress .stage-step-label')).toHaveText(['基础关联', '优化关联', '增补关联'])
  await page.goto('/business?tab=plans&taskId=42')
  await expect(page.locator('.stage-step-progress .stage-step-label')).toHaveText(['满足度评估', '规划输出', '方案审核', '方案发布'])
  await businessNavigation.getByRole('button', { name: '过程管理与成果追溯', exact: true }).click()
  await expect(page).toHaveURL(/\/business\/execution\?taskId=42/)
  await expect(page.locator('.business-stage-progress .business-stage-label')).toHaveText([
    '需求查询',
    '资源选择',
    '能力评估',
    '资源配置',
    '方案管理',
    '过程管理与成果追溯',
  ])
  await expect(page.locator('.stage-step-progress .stage-step-label')).toHaveText(['执行启动', '执行监控', '异常处理', '成果查看'])

  await page.getByRole('button', { name: /任务中心/ }).click()
  await expect(page.locator('.rail-subnav').filter({ hasText: '任务创建' }).locator('.rail-subitem--staged')).toHaveCount(0)
  await expect(page.locator('.rail-subnav').filter({ hasText: '任务创建' }).locator('.rail-stage')).toHaveCount(0)

  await page.getByRole('button', { name: /应用中心/ }).click()
  const applicationNavigation = page.locator('.rail-subnav').filter({ hasText: '场景主题配置' })
  await expect(applicationNavigation.locator('.rail-subitem-label')).toHaveText([
    '场景主题配置',
    '场景任务发起',
    'GIS综合展示',
    '任务进程与成果查看',
    '场景统计分析',
  ])
  await expect(applicationNavigation.locator('.rail-stage')).toHaveCount(0)
})

test('任务入口将查看、继续、地图和全过程分成独立动作', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ json: { data: { csrfToken: 'test' } } })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } })
    if (url.pathname.endsWith('/planning/tasks')) return route.fulfill({ json: { data: [{ id: 42, name: '暴雨观测', code: 'TASK-42', status: 'submitted', observationTarget: '验证任务入口动作' }] } })
    if (url.pathname.endsWith('/planning/tasks/42')) return route.fulfill({ json: { data: { id: 42, name: '暴雨观测', code: 'TASK-42', status: 'submitted', observationTarget: '验证任务入口动作' } } })
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto('/business?tab=tasks')
  const card = page.locator('.task-entry-card')
  await expect(card.getByRole('button', { name: '查看需求' })).toBeVisible()
  await card.getByRole('button', { name: '查看需求' }).click()
  await expect(page).toHaveURL(/\/business\?tab=tasks&taskId=42/)
  await expect(card.getByRole('button', { name: '继续处理' })).toBeVisible()
  await card.getByRole('button', { name: '继续处理' }).click()
  await expect(page).toHaveURL(/\/business\?tab=candidates&taskId=42/)
})

test('传感器只读模式切换分区后保持只读并显式进入编辑', async ({ page }) => {
  const detail = {
    id: 1,
    name: '雨量传感器',
    type: '气象传感器',
    platformName: '示范平台',
    platformStatus: 'active',
    general: { name: '示范平台', sensorName: '雨量传感器', identifier: 'RAIN-001', status: 'active' },
    attributes: { capability: { principle: '翻斗计量', parameters: {} }, spatialResolutionM: 10, temporalResolutionSeconds: 60, accuracyPercent: 95, reliabilityPercent: 98 },
    measurementItems: [],
    profileCompleteness: { completedCount: 2, totalCount: 8, ratio: 0.25, sections: [] },
    permissions: { canView: true, canEditGeneral: true, canEditCapabilities: true, canEditInterfacesAndConstraints: true },
    spatiotemporal: {}, geographic: {}, history: [], contact: {}, constraints: {}, interfaces: [],
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ json: { data: { csrfToken: 'test' } } })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } })
    if (url.pathname.endsWith('/observations/sensors')) return route.fulfill({ json: { data: [{ id: 1, sensorName: '雨量传感器', platformName: '示范平台' }] } })
    if (url.pathname.endsWith('/resource/sensors/1/octuple')) return route.fulfill({ json: { data: detail } })
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto('/resources/sensors?tab=crud&sensorId=1&section=general&mode=view')
  await expect(page.locator('.archive-fields')).toHaveAttribute('disabled', '')
  await page.getByRole('button', { name: /传感器观测能力/ }).click()
  await expect(page).toHaveURL(/section=attributes.*mode=view/)
  await expect(page.locator('.archive-fields')).toHaveAttribute('disabled', '')
  await page.getByRole('button', { name: '进入编辑' }).click()
  await expect(page).toHaveURL(/section=attributes.*mode=edit/)
  await expect(page.locator('.archive-fields')).not.toHaveAttribute('disabled', '')
})

test('维护完整档案从后端完整度定位第一个未完成分区', async ({ page }) => {
  const detail = {
    id: 1, name: '雨量传感器', type: '气象传感器', platformName: '示范平台', platformStatus: 'active',
    general: { name: '示范平台', sensorName: '雨量传感器', identifier: 'RAIN-001', status: 'active' },
    attributes: { capability: { principle: '翻斗计量', parameters: {} } }, measurementItems: [],
    profileCompleteness: {
      completedCount: 1, totalCount: 8, ratio: 0.125,
      sections: [{ key: 'general', status: 'complete' }, { key: 'attributes', status: 'incomplete' }],
    },
    permissions: { canView: true, canEditGeneral: true, canEditCapabilities: true, canEditInterfacesAndConstraints: true },
    spatiotemporal: {}, geographic: {}, history: [], contact: {}, constraints: {}, interfaces: [],
  }
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/auth/csrf')) return route.fulfill({ json: { data: { csrfToken: 'test' } } })
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { data: { id: 1, username: 'e2e', displayName: 'E2E 用户', isStaff: true } } })
    if (url.pathname.endsWith('/observations/sensors')) return route.fulfill({ json: { data: [{ id: 1, sensorName: '雨量传感器', platformName: '示范平台' }] } })
    if (url.pathname.endsWith('/resource/sensors/1/octuple')) return route.fulfill({ json: { data: detail } })
    return route.fulfill({ json: { data: [] } })
  })

  await page.goto('/resources/sensors?tab=crud&sensorId=1&section=general&mode=edit&focus=incomplete')
  await expect(page).toHaveURL(/section=attributes.*focus=incomplete/)
  await expect(page.getByRole('heading', { name: '传感器观测能力' })).toBeVisible()
})
