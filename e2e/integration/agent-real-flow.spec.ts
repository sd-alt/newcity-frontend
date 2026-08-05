import { test, expect } from '@playwright/test'

test('真实 Vue → Django → Worker → FakeProvider → MAF 链路可以创建并展示任务', async ({ page }) => {
  await page.goto('/login?redirect=/application/tasks')
  await page.locator('input[name="username"]').fill('e2e')
  await page.locator('input[name="password"]').fill('e2e-pass')
  await page.getByRole('button', { name: '进入系统' }).click()

  await expect(page).toHaveURL(/\/application\/tasks/)
  const modeCard = page.locator('.task-launch-card .mode-card').filter({ hasText: '多Agent自动规划' })
  const sceneSelect = page.locator('.task-launch-card select').first()
  await expect(sceneSelect.locator('option')).not.toHaveCount(1)
  await modeCard.click()
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
    timeout: 120_000,
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

  await page.getByRole('button', { name: '任务图', exact: true }).dispatchEvent('click')
  await expect(page.locator('[aria-label="任务规划"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[aria-label="按依赖层级排列的任务图"]')).toBeVisible()
  await page.getByRole('button', { name: '技术记录', exact: true }).dispatchEvent('click')
  await expect(page.getByText('Microsoft Agent Framework')).toBeVisible()
  await expect(page.getByText('validated', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('llm', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('resource_query', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('answer：已完成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '结果', exact: true }).dispatchEvent('click')
  await expect(page.locator('[aria-label="最终业务结果"]')).toContainText('查询完成')
  await expect(page.locator('[aria-label="最终业务结果"]')).toContainText('Fake Provider 已完成')
  await expect(page.locator('[aria-label="最终业务结果"]')).toContainText('传感器数量')
})

test('完整规划经过三次人工确认后执行并汇集成果', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/login?redirect=/application/tasks')
  await page.locator('input[name="username"]').fill('e2e')
  await page.locator('input[name="password"]').fill('e2e-pass')
  await page.getByRole('button', { name: '进入系统' }).click()
  await expect(page).toHaveURL(/\/application\/tasks/)

  const modeCard = page.locator('.task-launch-card .mode-card').filter({ hasText: '多Agent自动规划' })
  const sceneSelect = page.locator('.task-launch-card select').first()
  await expect(sceneSelect.locator('option')).not.toHaveCount(1)
  await modeCard.click()
  await sceneSelect.selectOption({ index: 1 })
  await page.locator('.task-launch-card textarea').fill('执行完整规划，完成降雨监测方案、三次人工确认、任务执行和成果汇集。')
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/application/agent-tasks/'))
  await page.getByRole('button', { name: /启动多Agent自动规划/ }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.ok()).toBeTruthy()
  const createPayload = await createResponse.json()
  const runId = String(createPayload.data.runId)

  let lastRun: Record<string, any> = {}
  const fetchRun = async () => {
    lastRun = await page.evaluate(async (id) => {
      const response = await fetch(`/api/agent/runs/${id}/`)
      const payload = await response.json()
      return payload.data
    }, runId)
    return lastRun
  }
  for (const stage of ['indicator_confirmation', 'plan_confirmation', 'dispatch_confirmation']) {
    await expect.poll(async () => {
      const current = await fetchRun()
      const approval = (current.pendingApprovals || []).find((item: Record<string, any>) => item.status === 'pending')
      return `${current.status}:${current.currentStage}:${approval?.checkpointId || ''}`
    }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toMatch(new RegExp(`^waiting_approval:${stage}:.+`))
    await page.goto(`/application/tasks?runId=${runId}`)
    const approve = page.getByRole('button', { name: '确认并继续' })
    await expect(approve).toBeEnabled({ timeout: 15_000 })
    await approve.click()
  }

  await expect.poll(async () => (await fetchRun()).status, {
    timeout: 120_000,
    intervals: [500, 1000, 2000],
  }).toBe('completed')
  expect(lastRun.executionWorkflow.graphType).toBe('full_observation_planning')
  expect(lastRun.executionWorkflow.nodes.find((item: Record<string, any>) => item.nodeType === 'task_completed')?.status).toBe('completed')
  expect(lastRun.resultSummary.result.summary).toContain('完成')
  expect(lastRun.pendingApprovals.filter((item: Record<string, any>) => item.status === 'pending')).toHaveLength(0)
})
