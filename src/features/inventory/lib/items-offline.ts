"use client"

import { localDB } from "@/lib/sync/local-db"
import { LEGACY_ITEM_API_MUTATION_TABLE, queueApiRequest } from "@/lib/sync/api-mutations"

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const API_MUTATION_TABLE = LEGACY_ITEM_API_MUTATION_TABLE

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
  return queueApiRequest({ ...input, label: "عملية صنف" })
}

export { API_MUTATION_TABLE }
