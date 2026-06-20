"use client"

import { network } from "@/lib/network"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"

export type PartnerRecord = Record<string, unknown> & {
  id: string
  pharmacy_id: string
  type: "customer" | "supplier" | "both"
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  tax_id?: string | null
  opening_balance?: number
  balance?: number
  credit_limit?: number
  notes?: string | null
  status?: "active" | "inactive"
  created_at?: string
  updated_at?: string
  _offline_pending?: boolean
}

type ListInput = {
  pharmacyId: string
  type?: "customer" | "supplier"
  query?: string
  status?: string
  page?: number
  pageSize?: number
}

export type PartnersPayload = {
  partners: PartnerRecord[]
  summary: { count: number; total: number; active: number; inactive: number; totalBalance: number; openingBalance: number; creditLimit: number }
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  offline?: boolean
}

function normalize(row: PartnerRecord): PartnerRecord {
  return {
    ...row,
    opening_balance: Number(row.opening_balance ?? 0),
    balance: Number(row.balance ?? 0),
    credit_limit: Number(row.credit_limit ?? 0),
    status: row.status === "inactive" ? "inactive" : "active",
  }
}

function matchesType(row: PartnerRecord, type?: "customer" | "supplier") {
  if (!type) return true
  return row.type === type || row.type === "both"
}

async function localList(input: ListInput): Promise<PartnersPayload> {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(10, Math.min(250, input.pageSize ?? 25))
  const needle = String(input.query ?? "").trim().toLocaleLowerCase("ar")
  const all = (await localDB.getTableRows("pharmacy_partners"))
    .map((row) => normalize(row as PartnerRecord))
    .filter((row) => row.pharmacy_id === input.pharmacyId)
    .filter((row) => matchesType(row, input.type))
    .filter((row) => !input.status || input.status === "all" || row.status === input.status)
    .filter((row) => !needle || [row.name, row.phone, row.email, row.tax_id].some((value) => String(value ?? "").toLocaleLowerCase("ar").includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"))
  const offset = (page - 1) * pageSize
  const summary = {
    count: all.length,
    total: all.length,
    active: all.filter((row) => row.status === "active").length,
    inactive: all.filter((row) => row.status !== "active").length,
    totalBalance: all.reduce((sum, row) => sum + Number(row.balance ?? 0), 0),
    openingBalance: all.reduce((sum, row) => sum + Number(row.opening_balance ?? 0), 0),
    creditLimit: all.reduce((sum, row) => sum + Number(row.credit_limit ?? 0), 0),
  }
  return {
    partners: all.slice(offset, offset + pageSize),
    summary,
    pagination: { page, pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) },
    offline: true,
  }
}

export const partnersService = {
  async list(input: ListInput): Promise<PartnersPayload> {
    if (await network.check()) {
      try {
        const params = new URLSearchParams({ pharmacy_id: input.pharmacyId, page: String(input.page ?? 1), page_size: String(input.pageSize ?? 25) })
        if (input.type) params.set("type", input.type)
        if (input.query) params.set("query", input.query)
        if (input.status) params.set("status", input.status)
        const response = await fetch(`/api/partners?${params}`, { cache: "no-store", credentials: "same-origin" })
        const payload = await response.json().catch(() => ({})) as PartnersPayload & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تحميل جهات الاتصال")
        const rows = (payload.partners ?? []).map(normalize)
        await localDB.putTableRows("pharmacy_partners", rows as unknown as Record<string, unknown>[], true)
        return { ...payload, partners: rows, offline: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    return localList(input)
  },

  async create(pharmacyId: string, input: Record<string, unknown>) {
    const requestId = String(input.client_request_id ?? crypto.randomUUID())
    const body = { ...input, pharmacy_id: pharmacyId, client_request_id: requestId }
    if (await network.check()) {
      try {
        const response = await fetch("/api/partners", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as PartnerRecord & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل إنشاء جهة الاتصال")
        await localDB.putTableRow("pharmacy_partners", normalize(payload), true)
        return { partner: normalize(payload), queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const now = new Date().toISOString()
    const opening = Math.max(0, Number(input.opening_balance) || 0)
    const local = normalize({
      id: requestId,
      client_request_id: requestId,
      pharmacy_id: pharmacyId,
      type: input.type === "supplier" ? "supplier" : input.type === "both" ? "both" : "customer",
      name: String(input.name ?? "").trim(),
      phone: String(input.phone ?? "").trim() || null,
      email: String(input.email ?? "").trim() || null,
      address: String(input.address ?? "").trim() || null,
      tax_id: String(input.tax_id ?? "").trim() || null,
      opening_balance: opening,
      balance: opening,
      credit_limit: Math.max(0, Number(input.credit_limit) || 0),
      notes: String(input.notes ?? "").trim() || null,
      status: input.status === "inactive" ? "inactive" : "active",
      created_at: now,
      updated_at: now,
      _offline_pending: true,
    })
    await localDB.putTableRow("pharmacy_partners", local, false)
    await queueApiRequest({ path: "/api/partners", method: "POST", body, label: `إضافة ${local.type === "supplier" ? "المورد" : "العميل"} ${local.name}` })
    return { partner: local, queued: true }
  },

  async update(pharmacyId: string, partnerId: string, input: Record<string, unknown>) {
    const body = { ...input, pharmacy_id: pharmacyId, client_request_id: String(input.client_request_id ?? crypto.randomUUID()) }
    if (await network.check()) {
      try {
        const response = await fetch(`/api/partners/${partnerId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as PartnerRecord & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تعديل جهة الاتصال")
        await localDB.putTableRow("pharmacy_partners", normalize(payload), true)
        return { partner: normalize(payload), queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const existing = await localDB.getTableRow("pharmacy_partners", partnerId)
    if (!existing) throw new Error("جهة الاتصال غير موجودة على الجهاز")
    const updated = normalize({ ...existing, ...input, id: partnerId, pharmacy_id: pharmacyId, updated_at: new Date().toISOString(), _offline_pending: true } as PartnerRecord)
    await localDB.putTableRow("pharmacy_partners", updated, false)
    await queueApiRequest({ path: `/api/partners/${partnerId}`, method: "PATCH", body, label: `تعديل جهة الاتصال ${updated.name}` })
    return { partner: updated, queued: true }
  },

  async bulkStatus(pharmacyId: string, ids: string[], action: "activate" | "deactivate") {
    const body = { pharmacy_id: pharmacyId, ids, action }
    if (await network.check()) {
      try {
        const response = await fetch("/api/partners", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as { partners?: PartnerRecord[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تنفيذ الإجراء")
        await localDB.putTableRows("pharmacy_partners", (payload.partners ?? []).map(normalize) as unknown as Record<string, unknown>[], true)
        return { queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const status = action === "activate" ? "active" : "inactive"
    for (const id of ids) {
      const row = await localDB.getTableRow("pharmacy_partners", id)
      if (row) await localDB.putTableRow("pharmacy_partners", { ...row, status, updated_at: new Date().toISOString(), _offline_pending: true }, false)
    }
    await queueApiRequest({ path: "/api/partners", method: "PATCH", body, label: `${action === "activate" ? "تفعيل" : "تعطيل"} جهات اتصال` })
    return { queued: true }
  },
}
