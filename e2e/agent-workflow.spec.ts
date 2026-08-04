import { test, expect } from '@playwright/test'

test('Agent 工作台展示独立的规划图和执行图', async ({ page }) => {
  const planningNodes = [
    ['requirement', '需求理解'], ['classification', '任务分类'], ['graph_planning', '图规划'], ['validation', '图校验'],
  ].map(([nodeId, name], index) => ({ nodeId, nodeType: nodeId, code: nodeId, name, status: 'completed', mandatory: true, riskLevel: 'low', planningReason: '真实规划节点', topologicalLevel: index, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }))
  const workflow = {
    name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'resource_query', goal: '执行图', graphVersion: 1,
    checkpointId: '', status: 'completed', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0,
    nodes: [{ nodeId: 'task_completed', nodeType: 'task_completed', code: 'task_completed', name: '任务完成', status: 'completed', mandatory: true, riskLevel: 'medium', planningReason: '', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [],
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
  await expect(page.locator('[aria-label="Planning Workflow"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('需求理解 → 任务分类 → 图规划 → 图校验')).toBeVisible()
  await expect(page.getByText('Microsoft Agent Framework')).toBeVisible()
  await expect(page.getByLabel('按依赖层级排列的 Workflow 节点').getByText('任务完成')).toBeVisible()
})

test('执行异常只展示结构化处置，不展示普通补充输入', async ({ page }) => {
  const run = {
    id: '00000000-0000-0000-0000-000000000002', status: 'waiting_input', currentStage: 'execution_active_monitor', progress: 70,
    workflow: { name: 'execution', mode: 'dynamic-maf', source: 'llm', graphType: 'full_observation_planning', goal: '执行图', graphVersion: 1, checkpointId: 'checkpoint-2', status: 'waiting_input', fallback: false, fallbackReason: '', nodeCount: 1, edgeCount: 0, nodes: [{ nodeId: 'execution_active_monitor', nodeType: 'execution_active_monitor', code: 'execution_active_monitor', name: '执行主动监控', status: 'waiting_input', mandatory: true, riskLevel: 'high', planningReason: '监控执行状态', topologicalLevel: 0, dependsOn: [], toolNames: [], allowedToolNames: [], inputSummary: {}, outputSummary: {}, errorMessage: '' }], edges: [] },
    pendingApprovals: [{ id: 7, type: 'execution_intervention', title: '执行异常需要人工处理', description: '存在执行失败的执行项，请选择重试、转人工或取消。', status: 'pending', payload: { executionItems: [{ id: 9, name: '雨量观测', status: 'failed', progress: 50, retryCount: 0, errorMessage: '接口超时', availableActions: ['retry', 'manual', 'cancel'] }] } }],
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
    pendingApprovals: [{ id: 8, type: 'plan_resource_selection', title: '请选择替代资源', description: '必须明确旧资源和新资源。', status: 'pending', payload: { planId: 1, planVersion: 4, existingResources: [{ id: 12, resourceType: 'sensor', resourceId: 101, resourceName: '旧雨量传感器' }], candidates: [{ id: 205, name: '新雨量传感器', matched: true }] } }],
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
  const firstClick = button.click()
  await expect.poll(() => submitCount).toBe(1)
  await expect(button).toBeDisabled()
  await expect(button).toHaveText('正在提交')
  await button.click({ force: true })
  await expect.poll(() => submitCount).toBe(1)
  releaseManualRequest?.()
  await firstClick
})
