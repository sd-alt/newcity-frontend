import type { Envelope } from './types'

const CSRF_COOKIE = 'csrftoken'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  if (!match || match[1] == null) return null
  return decodeURIComponent(match[1])
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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    const csrf = readCookie(CSRF_COOKIE)
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
    const message =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : `HTTP ${response.status}`
    throw new ApiError(response.status, message, body)
  }
  return body as T
}

export async function apiEnvelope<T>(path: string, options?: RequestInit): Promise<Envelope<T>> {
  return apiRequest<Envelope<T>>(path, options)
}
