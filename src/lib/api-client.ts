/**
 * Backward-compatible entry point.
 * The implementation lives in lib/http so the application has one HTTP stack.
 */
export { ApiError as ApiRequestError } from "./http/api-error"
export {
  apiClient,
  apiRequest,
  buildUrl,
  HttpClient,
  isNetworkError,
  isRequestAbort,
  type ApiRequestOptions,
  type LegacyApiRequestOptions,
  type QueryParams,
  type QueryValue,
} from "./http/api-client"
