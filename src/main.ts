import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'

const app = createApp(App)

// Global error handler: catch unhandled Vue errors so the app doesn't crash silently
app.config.errorHandler = (err, _instance, info) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[Vue Error]', message, info)
  // If there's a global error container rendered by the app shell, populate it.
  // Fall back to appending a dismissible banner to #app.
  const banner = document.getElementById('global-error-banner')
  if (banner) {
    banner.textContent = `应用错误：${message}`
    banner.style.display = 'block'
    return
  }
  let el = document.getElementById('vue-global-error')
  if (!el) {
    el = document.createElement('div')
    el.id = 'vue-global-error'
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:#fef2f2;border-bottom:2px solid #fca5a5;color:#991b1b;' +
      'padding:8px 16px;font-size:13px;font-family:inherit;display:flex;align-items:center;gap:10px'
    const dismiss = document.createElement('button')
    dismiss.textContent = '关闭'
    dismiss.style.cssText =
      'margin-left:auto;border:0;background:transparent;color:#991b1b;cursor:pointer;font-weight:600;font:inherit'
    dismiss.onclick = () => el!.remove()
    el.appendChild(dismiss)
    document.body.prepend(el)
  }
  // Prepend the message before the dismiss button
  const textNode = document.createTextNode(`应用错误：${message}`)
  el.insertBefore(textNode, el.firstChild)
}

// Global warning handler for non-fatal issues (e.g. deprecated features)
app.config.warnHandler = (msg, _instance, trace) => {
  if (import.meta.env.DEV) {
    console.warn('[Vue Warning]', msg, trace)
  }
}

app.use(router).mount('#app')
