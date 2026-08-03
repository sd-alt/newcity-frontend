import type { Envelope } from './types'

const CSRF_COOKIE = 'csrftoken'
const DEFAULT_API_TIMEOUT_MS = 30_000
const CSRF_TIMEOUT_MS = 10_000
let lastCsrfFromBody: string | null = null

export type ApiRequestOptions = RequestInit & {
  /** 单次请求超时；大文件上传和模型调用可按接口延长。 */
  timeoutMs?: number
}

function createTimeoutSignal(source: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortFromCaller = () => controller.abort()

  if (source?.aborted) controller.abort()
  else source?.addEventListener('abort', abortFromCaller, { once: true })

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timer)
      source?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  if (!match || match[1] == null) return null
  return decodeURIComponent(match[1])
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body) {
    const obj = body as Record<string, unknown>
    if (typeof obj.detail === 'string') return obj.detail
    if (typeof obj.message === 'string') return obj.message
  }
  if (typeof body === 'string' && body.trim()) return body
  return 'HTTP ' + status
}

function isCsrfFailure(status: number, message: string): boolean {
  if (status !== 403) return false
  return /csrf/i.test(message) || /trusted origins/i.test(message)
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function ensureCsrfCookie(force = false): Promise<string | null> {
  if (!force) {
    const existing = readCookie(CSRF_COOKIE)
    if (existing) return existing
    if (lastCsrfFromBody) return lastCsrfFromBody
  }
  const timeout = createTimeoutSignal(undefined, CSRF_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('/api/v1/auth/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    })
  } catch (cause) {
    if (timeout.didTimeout()) {
      throw new ApiError(408, 'CSRF 请求超时，请稍后重试', { timeoutMs: CSRF_TIMEOUT_MS })
    }
    throw cause
  } finally {
    timeout.cleanup()
  }
  try {
    const body = await res.clone().json() as { data?: { csrfToken?: string } }
    const token = body?.data?.csrfToken
    if (typeof token === 'string' && token) lastCsrfFromBody = token
  } catch {
    /* 忽略解析异常 */
  }
  return readCookie(CSRF_COOKIE) || lastCsrfFromBody
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  retried = false,
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...requestOptions } = options
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const isWrite = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)
  if (isWrite) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    if (!headers.has('Content-Type') && options.body && isFormData === false) {
      headers.set('Content-Type', 'application/json')
    }
    if (isFormData && headers.has('Content-Type')) {
      headers.delete('Content-Type')
    }
    const csrf = await ensureCsrfCookie(false)
    if (csrf) headers.set('X-CSRFToken', csrf)
  }

  const timeout = createTimeoutSignal(options.signal, timeoutMs)
  let response: Response
  let body: unknown
  try {
    response = await fetch(path, {
      ...requestOptions,
      method,
      headers,
      credentials: 'include',
      signal: timeout.signal,
    })
    body = await parseBody(response)
  } catch (cause) {
    if (timeout.didTimeout()) {
      throw new ApiError(408, `请求超时（${timeoutMs}ms），请稍后重试`, { timeoutMs })
    }
    throw cause
  } finally {
    timeout.cleanup()
  }
  if (!response.ok) {
    const message = errorMessage(body, response.status)
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('newcity:auth-expired'))
    }
    if (isWrite && !retried && isCsrfFailure(response.status, message)) {
      await ensureCsrfCookie(true)
      return apiRequest<T>(path, options, true)
    }
    throw new ApiError(response.status, message, body)
  }
  return body as T
}

export async function apiEnvelope<T>(path: string, options?: ApiRequestOptions): Promise<Envelope<T>> {
  return apiRequest<Envelope<T>>(path, options)
}
