import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const backendRoot = process.env.NEWCITY_INTEGRATION_BACKEND_ROOT
  ? path.resolve(process.env.NEWCITY_INTEGRATION_BACKEND_ROOT)
  : path.resolve(process.cwd(), '..', 'newcity')
const backendScript = path.join(backendRoot, 'scripts', 'start_frontend_integration.ps1')
const backendPort = process.env.NEWCITY_E2E_BACKEND_PORT || '8011'
const backendURL = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  testDir: './e2e/integration',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
  },
  // 该配置启动独立 SQLite、Django、Fake Provider、Agent Worker 和 Vite。
  webServer: [
    {
      command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${backendScript}"`,
      url: `${backendURL}/api/health/`,
      env: {
        ...process.env,
        NEWCITY_E2E_BACKEND_PORT: backendPort,
        NEWCITY_INTEGRATION_REPO: backendRoot,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      env: { ...process.env, VITE_API_PROXY_TARGET: backendURL },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
