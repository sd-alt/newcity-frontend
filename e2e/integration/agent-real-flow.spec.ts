import { test, expect } from '@playwright/test'

test('真实 Vue → Django → Worker → FakeProvider → MAF 链路可以创建并展示任务', async ({ page }) => {
  await page.goto('/login?redirect=/application/tasks')
  await page.locator('input[name="username"]').fill('e2e')
  await page.locator('input[name="password"]').fill('e2e-pass')
  await page.getByRole('button', { name: '进入系统' }).click()

  await expect(page).toHaveURL(/\/application\/tasks/)
  const modeSelect = page.locator('.task-launch-card select').first()
  const sceneSelect = page.locator('.task-launch-card select').nth(1)
  await expect(sceneSelect.locator('option')).not.toHaveCount(1)
  await modeSelect.selectOption({ label: '多Agent自动规划' })
  await sceneSelect.selectOption({ index: 1 })
  await page.locator('.task-launch-card textarea').fill('验证真实 Agent Workflow 的动态任务图链路')
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/application/agent-tasks/'))
  await page.getByRole('button', { name: /启动多Agent自动规划/ }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.ok()).toBeTruthy()
  const createPayload = await createResponse.json()
  const runId = String(createPayload.data.runId)

  let lastRun: Record<string, any> = {}
  await expect.poll(async () => {
    lastRun = await page.evaluate(async (id) => {
      const response = await fetch(`/api/agent/runs/${id}/`)
      const payload = await response.json()
      return payload.data
    }, runId)
    if (lastRun.status === 'completed') return 'completed'
    const workflow = lastRun.executionWorkflow || lastRun.workflow || {}
    const currentNode = (workflow.nodes || []).find((item: Record<string, any>) => item.status === 'running')
    return JSON.stringify({
      runStatus: lastRun.status,
      planningStatus: lastRun.planningWorkflow?.status,
      workflowStatus: workflow.status,
      currentNode: currentNode?.nodeId || lastRun.currentStage,
      fallback: workflow.fallback,
      fallbackReason: workflow.fallbackReason,
      recentEvents: (workflow.events || []).slice(-5),
      workerErrors: (lastRun.errors || []).slice(-3),
      latestModelCall: (lastRun.modelCalls || []).slice(-1)[0] || null,
    })
  }, {
    timeout: 90_000,
    intervals: [500, 1000, 2000],
  }).toBe('completed')

  const planningWorkflow = lastRun.planningWorkflow
  const executionWorkflow = lastRun.executionWorkflow
  expect(planningWorkflow.status).toBe('validated')
  expect(executionWorkflow.source).toBe('llm')
  expect(executionWorkflow.graphType).toBe('resource_query')
  expect(executionWorkflow.fallback).toBe(false)
  expect(executionWorkflow.nodes.map((item: Record<string, any>) => item.nodeId)).toEqual([
    'understand',
    'query-sensors',
    'answer',
  ])
  expect(executionWorkflow.nodes.find((item: Record<string, any>) => item.nodeId === 'answer')?.status).toBe('completed')
  expect(lastRun.modelCalls.some((item: Record<string, any>) => item.phase === 'planning')).toBe(true)
  expect(lastRun.artifacts.some((item: Record<string, any>) => item.type === 'model_input')).toBe(true)
  expect(lastRun.artifacts.some((item: Record<string, any>) => item.type === 'model_validated_output')).toBe(true)

  await expect(page.locator('[aria-label="Planning Workflow"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Microsoft Agent Framework')).toBeVisible()
  await expect(page.locator('[aria-label="按依赖层级排列的 Workflow 节点"]')).toBeVisible()
  await page.getByRole('button', { name: '刷新' }).click()
  await expect(page.locator('[aria-label="Agent最终业务结果"]')).toContainText('查询完成')
  await expect(page.locator('[aria-label="Agent最终业务结果"]')).toContainText('Fake Provider 已完成')
  await expect(page.locator('[aria-label="Agent最终业务结果"]')).toContainText('传感器数量')
  await expect(page.getByText('validated', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('llm', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('resource_query', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('answer：已完成', { exact: true })).toBeVisible()
})
