export type ApiErrorPayload = {
  error?: string
  message?: string
  code?: string
  details?: unknown
  [key: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly code?: string
  readonly details?: unknown
  readonly payload: ApiErrorPayload

  constructor(options: {
    message: string
    status: number
    statusText?: string
    payload?: ApiErrorPayload
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = "ApiError"
    this.status = options.status
    this.statusText = options.statusText ?? ""
    this.payload = options.payload ?? {}
    this.code = this.payload.code
    this.details = this.payload.details
  }

  get isUnauthorized() {
    return this.status === 401
  }

  get isForbidden() {
    return this.status === 403
  }

  get isNotFound() {
    return this.status === 404
  }

  get isRetryable() {
    return this.status === 408 || this.status === 429 || this.status >= 500
  }
}
