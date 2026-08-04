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
  await page.route('**/api/agent/runs/00000000-0000-0000-0000-000000000001/', async (route) => route.fulfill({ json: { data: run } }))

  await page.goto('/application/tasks?runId=00000000-0000-0000-0000-000000000001')
  await expect(page.locator('[aria-label="Planning Workflow"]')).toBeVisible()
  await expect(page.getByText('需求理解 → 任务分类 → 图规划 → 图校验')).toBeVisible()
  await expect(page.getByText('Microsoft Agent Framework')).toBeVisible()
  await expect(page.getByLabel('按依赖层级排列的 Workflow 节点').getByText('任务完成')).toBeVisible()
})
