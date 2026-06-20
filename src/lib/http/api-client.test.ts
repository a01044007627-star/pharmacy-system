import { ApiError } from "./api-error"
import { HttpClient } from "./api-client"

const originalFetch = global.fetch

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
}

describe("HttpClient", () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it("builds query strings and keeps shared request defaults", async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse({ rows: [] }))
    const client = new HttpClient("/api")

    await client.get("/items", { query: { page: 2, search: "دواء", empty: null } })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/items?page=2&search=%D8%AF%D9%88%D8%A7%D8%A1",
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin" }),
    )
  })

  it("serializes JSON bodies consistently", async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    const client = new HttpClient()

    await client.post("/api/settings", { enabled: true })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBe(JSON.stringify({ enabled: true }))
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json")
  })

  it("throws a typed ApiError with the server message", async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse({ error: "ليست لديك صلاحية", code: "FORBIDDEN" }, { status: 403 }))
    const client = new HttpClient()

    await expect(client.get("/api/settings")).rejects.toMatchObject({
      name: "ApiError",
      message: "ليست لديك صلاحية",
      status: 403,
      code: "FORBIDDEN",
      isForbidden: true,
    } satisfies Partial<ApiError>)
  })
})
