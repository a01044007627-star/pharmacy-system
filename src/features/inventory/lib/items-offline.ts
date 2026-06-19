"use client"

import { localDB } from "@/lib/sync/local-db"

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const API_MUTATION_TABLE = "__api_items__"

function keyPart(value: string) {
  return encodeURIComponent(value).replace(/%/g, "_")
}

export async function cacheItemsList(query: string, payload: unknown) {
  await localDB.setCache(`items:list:${keyPart(query)}`, payload, CACHE_TTL)
}

export async function readCachedItemsList<T>(query: string): Promise<T | null> {
  return await localDB.getCache(`items:list:${keyPart(query)}`) as T | null
}

export async function cacheItemDetail(itemId: string, payload: unknown) {
  await localDB.setCache(`items:detail:${itemId}`, payload, CACHE_TTL)
}

export async function readCachedItemDetail<T>(itemId: string): Promise<T | null> {
  return await localDB.getCache(`items:detail:${itemId}`) as T | null
}

export async function queueItemApiRequest(input: {
  path: string
  method: "POST" | "PATCH" | "DELETE"
  body: Record<string, unknown>
}) {
  const id = `item_api_${Date.now()}_${crypto.randomUUID()}`
  await localDB.queueMutation({
    id,
    table: API_MUTATION_TABLE,
    operation: input.method === "POST" ? "create" : input.method === "DELETE" ? "delete" : "update",
    data: input,
    created_at: new Date().toISOString(),
  })
  return id
}

export { API_MUTATION_TABLE }
