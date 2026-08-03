import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

function readPort(value: string | undefined, fallback: number) {
  const port = Number.parseInt(value || '', 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8001'
  const devServerHost = env.VITE_DEV_SERVER_HOST || '127.0.0.1'
  const devServerPort = readPort(env.VITE_DEV_SERVER_PORT, 5173)

  return {
    plugins: [vue(), cesium()],
    server: {
      host: devServerHost,
      port: devServerPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
