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
  await page.getByRole('button', { name: /启动多Agent自动规划/ }).click()

  await expect(page.locator('[aria-label="Planning Workflow"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Microsoft Agent Framework')).toBeVisible()
  await expect(page.locator('[aria-label="按依赖层级排列的 Workflow 节点"]')).toBeVisible()
})
