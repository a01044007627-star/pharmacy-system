"use client"

import { localDB } from "./local-db"

export const API_MUTATION_TABLE = "__api_requests__"
export const LEGACY_ITEM_API_MUTATION_TABLE = "__api_items__"

export type QueuedApiMethod = "POST" | "PATCH" | "PUT" | "DELETE"

export type QueuedApiRequest = {
  path: string
  method: QueuedApiMethod
  body?: Record<string, unknown>
  headers?: Record<string, string>
  label?: string
}

export async function queueApiRequest(input: QueuedApiRequest) {
  const id = `api_${Date.now()}_${crypto.randomUUID()}`
  await localDB.queueMutation({
    id,
    table: API_MUTATION_TABLE,
    operation: input.method === "POST" ? "create" : input.method === "DELETE" ? "delete" : "update",
    data: input,
    created_at: new Date().toISOString(),
  })
  return id
}
