import { ApiError, type ApiErrorPayload } from "./api-error"

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  body?: unknown
  query?: QueryParams
  fallbackMessage?: string
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

export type LegacyApiRequestOptions = RequestInit & {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  fallbackMessage?: string
}

const DEFAULT_ERROR_MESSAGE = "حدث خطأ أثناء الاتصال بالخادم"
const DEFAULT_TIMEOUT_MS = 18_000
const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function joinUrl(baseUrl: string, path: string) {
  if (!baseUrl) return path
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
}

export function buildUrl(path: string, query?: QueryParams) {
  if (!query) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const suffix = search.toString()
  return suffix ? `${path}${path.includes("?") ? "&" : "?"}${suffix}` : path
}

function abortError() {
  try {
    return new DOMException("The operation was aborted", "AbortError")
  } catch {
    const error = new Error("The operation was aborted")
    error.name = "AbortError"
    return error
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError || isAbortError(error)
}

export function isRequestAbort(error: unknown) {
  return isAbortError(error)
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("json")) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function asErrorPayload(payload: unknown): ApiErrorPayload {
  if (payload && typeof payload === "object") return payload as ApiErrorPayload
  if (typeof payload === "string" && payload.trim()) return { message: payload }
  return {}
}

function resolveErrorMessage(payload: ApiErrorPayload, fallbackMessage?: string) {
  return payload.error?.trim() || payload.message?.trim() || fallbackMessage || DEFAULT_ERROR_MESSAGE
}

function canRetry(method: string, status: number) {
  if (!SAFE_RETRY_METHODS.has(method)) return false
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

function serializeBody(body: unknown) {
  if (body === undefined || body === null) return undefined
  if (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit
  }
  return JSON.stringify(body)
}

function wait(ms: number, signal?: AbortSignal | null) {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export class HttpClient {
  constructor(
    private readonly baseUrl = "",
    private readonly defaults: RequestInit = {
      cache: "no-store",
      credentials: "same-origin",
    },
  ) {}

  get<T>(path: string, options?: ApiRequestOptions) {
    return this.request<T>("GET", path, options)
  }

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return this.request<T>("POST", path, { ...options, body })
  }

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return this.request<T>("PUT", path, { ...options, body })
  }

  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return this.request<T>("PATCH", path, { ...options, body })
  }

  delete<T>(path: string, options?: ApiRequestOptions) {
    return this.request<T>("DELETE", path, options)
  }

  async request<T>(methodInput: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
    const {
      body,
      query,
      fallbackMessage,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      retries = 1,
      retryDelayMs = 450,
      headers,
      signal: externalSignal,
      ...requestOptions
    } = options
    const method = methodInput.toUpperCase()
    const url = buildUrl(joinUrl(this.baseUrl, path), query)
    const requestHeaders = new Headers(this.defaults.headers)
    new Headers(headers).forEach((value, key) => requestHeaders.set(key, value))
    const serializedBody = serializeBody(body)
    if (serializedBody !== undefined && typeof body !== "string" && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json")
    }

    const maxRetries = SAFE_RETRY_METHODS.has(method) ? Math.max(0, retries) : 0
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (externalSignal?.aborted) throw abortError()

      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, Math.max(1, timeoutMs))
      const onExternalAbort = () => controller.abort()
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

      try {
        const response = await fetch(url, {
          ...this.defaults,
          ...requestOptions,
          method,
          headers: requestHeaders,
          body: serializedBody,
          signal: controller.signal,
        })
        const payload = await parsePayload(response)

        if (response.ok) return payload as T

        const errorPayload = asErrorPayload(payload)
        const apiError = new ApiError({
          message: resolveErrorMessage(errorPayload, fallbackMessage),
          status: response.status,
          statusText: response.statusText,
          payload: errorPayload,
        })
        lastError = apiError
        if (attempt >= maxRetries || !canRetry(method, response.status)) throw apiError
      } catch (error) {
        if (externalSignal?.aborted) throw abortError()
        if (isAbortError(error) && !timedOut) throw error

        lastError = timedOut
          ? new ApiError({ message: "انتهت مهلة تحميل البيانات. حاول مرة أخرى.", status: 408, cause: error })
          : error

        const status = lastError instanceof ApiError ? lastError.status : 0
        if (attempt >= maxRetries || !canRetry(method, status)) throw lastError
      } finally {
        clearTimeout(timeout)
        externalSignal?.removeEventListener("abort", onExternalAbort)
      }

      await wait(retryDelayMs * (attempt + 1), externalSignal)
    }

    throw lastError instanceof Error
      ? lastError
      : new ApiError({ message: fallbackMessage ?? DEFAULT_ERROR_MESSAGE, status: 0 })
  }
}

export const apiClient = new HttpClient()

/**
 * Compatibility wrapper for existing screens. New services should use apiClient/HttpClient directly.
 */
export function apiRequest<T>(input: RequestInfo | URL, options: LegacyApiRequestOptions = {}) {
  const {
    method = "GET",
    body,
    timeoutMs,
    retries,
    retryDelayMs,
    fallbackMessage,
    ...requestOptions
  } = options
  const path = input instanceof Request ? input.url : String(input)
  return apiClient.request<T>(method, path, {
    ...requestOptions,
    body,
    timeoutMs,
    retries,
    retryDelayMs,
    fallbackMessage,
  })
}
