"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import type { DashboardDateFilter, DashboardHomePayload } from "../types"
import { emptyDashboardHomePayload } from "../data"
import {
  getLocalDashboardPayload,
  getMemoryDashboardPayload,
  getSessionDashboardPayload,
  mergeDashboardPayload,
  setLocalDashboardPayload,
} from "../lib/dashboard-local-cache"

interface DashboardHomeDataState {
  data: DashboardHomePayload
  loading: boolean
  error: string | null
  source: "empty" | "memory" | "session" | "local" | "supabase"
}

const SUMMARY_TIMEOUT_MS = 4200
const FULL_TIMEOUT_MS = 12000
const EMPTY_FALLBACK_MS = 900
const inFlight = new Map<string, Promise<DashboardHomePayload>>()

function timeoutSignal(ms: number) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => window.clearTimeout(timeout), abort: () => controller.abort() }
}

async function fetchDashboardPayload(key: string, options?: { tables?: boolean; timeoutMs?: number }) {
  const tables = options?.tables !== false
  const requestKey = `${key}&tables=${tables ? "1" : "0"}`
  const existing = inFlight.get(requestKey)
  if (existing) return existing

  const timeout = timeoutSignal(options?.timeoutMs ?? FULL_TIMEOUT_MS)
  const request = fetch(`/api/dashboard/home?${requestKey}`, {
    cache: "no-store",
    signal: timeout.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? "فشل تحميل بيانات لوحة المتابعة")
      }
      return response.json() as Promise<DashboardHomePayload>
    })
    .finally(() => {
      timeout.cancel()
      inFlight.delete(requestKey)
    })

  inFlight.set(requestKey, request)
  return request
}

function scheduleIdle(callback: () => void, timeout = 250) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = (window as Window).requestIdleCallback(callback, { timeout })
    return () => (window as Window).cancelIdleCallback(id)
  }

  const id = (window as Window).setTimeout(callback, timeout)
  return () => (window as Window).clearTimeout(id)
}

function timeoutErrorText(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "الاتصال بسحابة Supabase بطيء؛ تم عرض آخر بيانات محلية متاحة لحين اكتمال التحديث."
  }
  if (error instanceof Error) return error.message
  return "فشل تحميل بيانات لوحة المتابعة"
}

export function useDashboardHomeData(dateFilter: DashboardDateFilter, branchFilter: string) {
  const [state, setState] = useState<DashboardHomeDataState>({
    data: emptyDashboardHomePayload,
    loading: true,
    error: null,
    source: "empty",
  })
  const [, startTransition] = useTransition()
  const lastKeyRef = useRef("")

  const params = useMemo(() => {
    const next = new URLSearchParams()
    next.set("date_filter", dateFilter)
    next.set("branch_id", branchFilter || "all")
    return next.toString()
  }, [branchFilter, dateFilter])

  useEffect(() => {
    let alive = true
    let hadInstantData = false
    let cancelIdleFullFetch: (() => void) | null = null
    lastKeyRef.current = params

    const memory = getMemoryDashboardPayload(params)
    if (memory) {
      hadInstantData = true
      setState({ data: memory, loading: false, error: null, source: "memory" })
    } else {
      const session = getSessionDashboardPayload(params)
      if (session) {
        hadInstantData = true
        setState({ data: session, loading: false, error: null, source: "session" })
      } else {
        setState((prev) => ({ ...prev, loading: true, error: null }))
      }
    }

    const emptyFallbackTimer = window.setTimeout(() => {
      if (!alive || hadInstantData || lastKeyRef.current !== params) return
      setState({ data: emptyDashboardHomePayload, loading: false, error: null, source: "empty" })
    }, EMPTY_FALLBACK_MS)

    getLocalDashboardPayload(params).then((local) => {
      if (!alive || !local || lastKeyRef.current !== params) return
      hadInstantData = true
      startTransition(() => {
        setState({ data: local, loading: false, error: null, source: "local" })
      })
    })

    fetchDashboardPayload(params, { tables: false, timeoutMs: SUMMARY_TIMEOUT_MS })
      .then((summary) => {
        if (!alive || lastKeyRef.current !== params) return
        startTransition(() => {
          setState((prev) => {
            const merged = mergeDashboardPayload(prev.data, summary)
            setLocalDashboardPayload(params, merged)
            return { data: merged, loading: false, error: null, source: "supabase" }
          })
        })
      })
      .catch((error) => {
        if (!alive || lastKeyRef.current !== params) return
        setState((prev) => ({
          data: prev.data,
          loading: false,
          error: prev.source === "empty" ? timeoutErrorText(error) : null,
          source: prev.source,
        }))
      })

    cancelIdleFullFetch = scheduleIdle(() => {
      fetchDashboardPayload(params, { tables: true, timeoutMs: FULL_TIMEOUT_MS })
        .then((full) => {
          if (!alive || lastKeyRef.current !== params) return
          setLocalDashboardPayload(params, full)
          startTransition(() => {
            setState({ data: full, loading: false, error: null, source: "supabase" })
          })
        })
        .catch((error) => {
          if (!alive || lastKeyRef.current !== params) return
          setState((prev) => ({
            data: prev.data,
            loading: false,
            error: prev.source === "empty" ? timeoutErrorText(error) : null,
            source: prev.source,
          }))
        })
    }, 500)

    return () => {
      alive = false
      window.clearTimeout(emptyFallbackTimer)
      cancelIdleFullFetch?.()
    }
  }, [params, startTransition])

  return state
}
