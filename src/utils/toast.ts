import { ref } from 'vue'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  level: ToastLevel
  createdAt: number
}

let _nextId = 0
const _defaultDuration = 4000

export const toasts = ref<Toast[]>([])

export function pushToast(message: string, level: ToastLevel = 'info', durationMs = _defaultDuration) {
  const id = ++_nextId
  const toast: Toast = { id, message, level, createdAt: Date.now() }
  toasts.value = [...toasts.value, toast]
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
  return id
}

export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** 提供便捷提示的辅助函数。 */
export const toast = {
  info: (msg: string) => pushToast(msg, 'info'),
  success: (msg: string) => pushToast(msg, 'success'),
  warn: (msg: string) => pushToast(msg, 'warning', 5000),
  error: (msg: string) => pushToast(msg, 'error', 8000),
}
