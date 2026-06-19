export class ApiRequestError<T = unknown> extends Error {
  readonly status: number
  readonly payload: T | null

  constructor(message: string, status = 0, payload: T | null = null) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.payload = payload
  }
}

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
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

function canRetry(method: string, status: number) {
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return false
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
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

async function parsePayload<T>(response: Response): Promise<T | null> {
  if (response.status === 204) return null
  const contentType = response.headers.get("content-type") ?? ""
  try {
    if (contentType.includes("application/json")) return await response.json() as T
    const text = await response.text()
    return (text ? { error: text } : null) as T | null
  } catch {
    return null
  }
}

function messageFromPayload(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return fallback
}

/**
 * طلب API موحّد بمهلة زمنية وإعادة محاولة آمنة لطلبات القراءة فقط.
 * لا يعيد POST/PATCH/DELETE تلقائيًا حتى لا تتكرر العمليات المالية أو المخزنية.
 */
export async function apiRequest<T>(input: RequestInfo | URL, options: ApiRequestOptions = {}): Promise<T> {
  const {
    timeoutMs = 18_000,
    retries = 1,
    retryDelayMs = 450,
    signal: externalSignal,
    ...init
  } = options
  const method = String(init.method ?? "GET").toUpperCase()
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (externalSignal?.aborted) throw abortError()

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      const payload = await parsePayload<T>(response)
      if (response.ok) return (payload ?? {}) as T

      const error = new ApiRequestError(
        messageFromPayload(payload, `فشل الاتصال بالخادم (${response.status})`),
        response.status,
        payload,
      )
      lastError = error
      if (attempt >= retries || !canRetry(method, response.status)) throw error
    } catch (error) {
      if (externalSignal?.aborted) throw abortError()
      if (isAbortError(error) && !timedOut) throw error

      lastError = timedOut
        ? new ApiRequestError("انتهت مهلة تحميل البيانات. حاول مرة أخرى.", 408)
        : error

      const status = lastError instanceof ApiRequestError ? lastError.status : 0
      if (attempt >= retries || !canRetry(method, status)) throw lastError
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", onExternalAbort)
    }

    await wait(retryDelayMs * (attempt + 1), externalSignal)
  }

  throw lastError instanceof Error ? lastError : new ApiRequestError("تعذر الاتصال بالخادم")
}

export function isRequestAbort(error: unknown) {
  return isAbortError(error)
}
