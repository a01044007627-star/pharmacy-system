import { ApiError, type ApiErrorPayload } from "./api-error"

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  body?: unknown
  query?: QueryParams
  fallbackMessage?: string
}

const DEFAULT_ERROR_MESSAGE = "حدث خطأ أثناء الاتصال بالخادم"

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

  async request<T>(method: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
    const { body, query, fallbackMessage, headers, ...requestOptions } = options
    const hasBody = body !== undefined
    const url = buildUrl(joinUrl(this.baseUrl, path), query)
    const requestHeaders = new Headers(this.defaults.headers)
    new Headers(headers).forEach((value, key) => requestHeaders.set(key, value))
    if (hasBody && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json")

    const response = await fetch(url, {
      ...this.defaults,
      ...requestOptions,
      method,
      headers: requestHeaders,
      body: hasBody ? JSON.stringify(body) : undefined,
    })
    const payload = await parsePayload(response)

    if (!response.ok) {
      const errorPayload = asErrorPayload(payload)
      throw new ApiError({
        message: resolveErrorMessage(errorPayload, fallbackMessage),
        status: response.status,
        statusText: response.statusText,
        payload: errorPayload,
      })
    }

    return payload as T
  }
}

export const apiClient = new HttpClient()

export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")
}
