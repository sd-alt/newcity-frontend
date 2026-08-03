import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'

const app = createApp(App)

// 全局错误处理器：捕获未处理的 Vue 错误，避免应用静默崩溃。
app.config.errorHandler = (err, _instance, info) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[Vue Error]', message, info)
  const safeMessage = import.meta.env.DEV ? message : '页面发生异常，请刷新后重试'
  // 如果应用外壳渲染了全局错误容器，则写入该容器。
  // 否则向 #app 追加一个可关闭的错误提示条。
  const banner = document.getElementById('global-error-banner')
  if (banner) {
    banner.textContent = `应用错误：${safeMessage}`
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
  // 将错误信息插入关闭按钮之前。
  const textNode = document.createTextNode(`应用错误：${safeMessage}`)
  el.insertBefore(textNode, el.firstChild)
}

// 全局警告处理器，用于处理非致命问题（例如已废弃的功能）。
app.config.warnHandler = (msg, _instance, trace) => {
  if (import.meta.env.DEV) {
    console.warn('[Vue Warning]', msg, trace)
  }
}

app.use(router).mount('#app')
