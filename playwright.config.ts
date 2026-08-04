import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 真实联调由独立配置启动 Django、Worker 和 Fake Provider，默认 Mock 测试不重复执行。
  testIgnore: '**/integration/**',
  // 当前测试共享同一套本地Mock API，串行执行可避免多个页面同时初始化时互相抢占开发服务器。
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // 本地优先使用已安装的 Chrome，CI 仍使用 Playwright 管理的 Chromium。
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
