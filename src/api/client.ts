import type { Envelope } from './types'

const CSRF_COOKIE = 'csrftoken'

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
  }
  await fetch('/api/v1/auth/csrf', {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  return readCookie(CSRF_COOKIE)
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
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

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'include',
  })
  const body = await parseBody(response)
  if (!response.ok) {
    const message = errorMessage(body, response.status)
    if (isWrite && !retried && isCsrfFailure(response.status, message)) {
      await ensureCsrfCookie(true)
      return apiRequest<T>(path, options, true)
    }
    throw new ApiError(response.status, message, body)
  }
  return body as T
}

export async function apiEnvelope<T>(path: string, options?: RequestInit): Promise<Envelope<T>> {
  return apiRequest<Envelope<T>>(path, options)
}