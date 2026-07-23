import { ApiError } from '../api/client'

function flattenErrors(value: unknown, prefix = ''): string[] {
  if (value == null) return []
  if (typeof value === 'string') return [prefix ? prefix + ': ' + value : value]
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) parts.push(...flattenErrors(item, prefix))
    return parts
  }
  if (typeof value === 'object') {
    const parts: string[] = []
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? prefix + '.' + key : key
      if (key === 'detail' || key === 'message' || key === 'non_field_errors') {
        parts.push(...flattenErrors(item, prefix))
      } else {
        parts.push(...flattenErrors(item, next))
      }
    }
    return parts
  }
  return [prefix ? prefix + ': ' + String(value) : String(value)]
}

export function errMessage(err: unknown, fallback = '操作失败') {
  if (err instanceof ApiError) {
    const body = err.body
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>
      if (typeof obj.message === 'string' && obj.message && obj.message !== 'success') {
        const nested = obj.data != null ? flattenErrors(obj.data) : []
        // 关联删除等业务冲突：直接展示业务文案，避免吓人的纯状态码
        if (err.status === 409) {
          if (nested.length) return obj.message + '：' + nested.slice(0, 4).join('；')
          return obj.message
        }
        if (nested.length) return obj.message + '：' + nested.slice(0, 4).join('；')
        return obj.message + ' (HTTP ' + err.status + ')'
      }
      if (err.status === 409) {
        return '该记录已被其他数据引用，不能删除'
      }
      const parts = flattenErrors(obj).filter((x) => x && x !== 'success')
      if (parts.length) return parts.slice(0, 5).join('；') + ' (HTTP ' + err.status + ')'
    }
    return err.message + ' (HTTP ' + err.status + ')'
  }
  if (err instanceof Error) return err.message
  return fallback
}

export function isoNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

export function pickId(row: Record<string, unknown> | undefined | null) {
  if (row == null) return ''
  return row.id == null ? '' : String(row.id)
}

export function canByStatus(status: unknown, allowed: string[]) {
  const s = String(status || '').toLowerCase()
  return allowed.includes(s)
}
