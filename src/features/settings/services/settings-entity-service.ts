"use client"

export type SettingsEntity =
  | "branches"
  | "tax-rates"
  | "tax-groups"
  | "tax-group-members"
  | "invoice-designs"
  | "barcode-papers"
  | "receipt-printers"
  | "notification-templates"
  | "backups"

export type EntityPayload = Record<string, unknown> & { id?: string }

type ListResponse<T> = { rows?: T[]; row?: T; error?: string }

async function readJson<T>(response: Response): Promise<ListResponse<T>> {
  const data = (await response.json().catch(() => ({}))) as ListResponse<T>
  if (!response.ok) throw new Error(data.error ?? "فشل تنفيذ عملية الإعدادات")
  return data
}

function query(entity: SettingsEntity, params?: Record<string, string | null | undefined>) {
  const search = new URLSearchParams({ entity })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value)
  }
  return `/api/settings/entities?${search.toString()}`
}

export const SettingsEntityService = {
  async list<T = EntityPayload>(entity: SettingsEntity, params?: Record<string, string | null | undefined>): Promise<T[]> {
    const data = await readJson<T>(await fetch(query(entity, params), { cache: "no-store" }))
    return data.rows ?? []
  },

  async get<T = EntityPayload>(entity: SettingsEntity, id: string): Promise<T | null> {
    const data = await readJson<T>(await fetch(`/api/settings/entities/${encodeURIComponent(id)}?entity=${encodeURIComponent(entity)}`, { cache: "no-store" }))
    return data.row ?? null
  },

  async create<T = EntityPayload>(entity: SettingsEntity, values: EntityPayload): Promise<T> {
    const data = await readJson<T>(await fetch("/api/settings/entities", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, values }),
    }))
    if (!data.row) throw new Error("فشل إنشاء السجل")
    return data.row
  },

  async update<T = EntityPayload>(entity: SettingsEntity, id: string, values: EntityPayload): Promise<T> {
    const data = await readJson<T>(await fetch(`/api/settings/entities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, values }),
    }))
    if (!data.row) throw new Error("فشل تحديث السجل")
    return data.row
  },

  async remove(entity: SettingsEntity, id: string): Promise<void> {
    await readJson(await fetch(`/api/settings/entities/${encodeURIComponent(id)}?entity=${encodeURIComponent(entity)}`, {
      method: "DELETE",
      cache: "no-store",
    }))
  },

  async setDefault<T = EntityPayload>(entity: SettingsEntity, id: string): Promise<T> {
    const data = await readJson<T>(await fetch(`/api/settings/entities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, setDefault: true, values: { is_default: true } }),
    }))
    if (!data.row) throw new Error("فشل تعيين الافتراضي")
    return data.row
  },
}
