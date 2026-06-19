"use client"

import { useEffect, useState, useCallback } from "react"
import { dataLayer, network, syncManager } from "@/lib/sync"
import type { SyncStatus } from "@/lib/sync"

export function useOnlineStatus() {
  const [online, setOnline] = useState(network.isOnline)

  useEffect(() => {
    const unsub = network.subscribe(setOnline)
    return () => unsub()
  }, [])

  return online
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(syncManager.status)

  useEffect(() => {
    const unsub = syncManager.subscribe(setStatus)
    return () => { unsub() }
  }, [])

  return status
}

export function useData<T>(table: string) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await dataLayer.query<T>(table)
        if (!cancelled) setData(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [table, fetchKey])

  useEffect(() => {
    const unsub = network.subscribe(() => { setFetchKey((k) => k + 1) })
    return () => unsub()
  }, [])

  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  return { data, loading, error, refetch }
}

export function useRecord<T>(table: string, id: string | null) {
  const [record, setRecord] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) {
        if (!cancelled) setRecord(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await dataLayer.getById<T>(table, id)
        if (!cancelled) setRecord(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [table, id, fetchKey])

  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  return { record, loading, error, refetch }
}

export function useMutation<T>(table: string) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const insert = useCallback(
    async (record: Partial<T>): Promise<T | null> => {
      setLoading(true)
      setError(null)
      try {
        const result = await dataLayer.insert<T>(table, record)
        return result
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
        return null
      } finally {
        setLoading(false)
      }
    },
    [table],
  )

  const update = useCallback(
    async (id: string, updates: Partial<T>): Promise<T | null> => {
      setLoading(true)
      setError(null)
      try {
        return await dataLayer.update<T>(table, id, updates)
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
        return null
      } finally {
        setLoading(false)
      }
    },
    [table],
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        await dataLayer.delete(table, id)
        return true
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
        return false
      } finally {
        setLoading(false)
      }
    },
    [table],
  )

  return { insert, update, remove, loading, error }
}

export function useNetwork() {
  const online = useOnlineStatus()
  const [checking, setChecking] = useState(false)

  const checkNow = useCallback(async () => {
    setChecking(true)
    const result = await network.check()
    setChecking(false)
    return result
  }, [])

  return { online, checking, checkNow }
}
