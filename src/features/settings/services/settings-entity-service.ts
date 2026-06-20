"use client"

import { apiClient, type QueryParams } from "@/lib/http/api-client"

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

type EntityResponse<T> = { rows?: T[]; row?: T }

export class SettingsEntityRepository {
  async list<T = EntityPayload>(entity: SettingsEntity, params?: QueryParams): Promise<T[]> {
    const data = await apiClient.get<EntityResponse<T>>("/api/settings/entities", {
      query: { entity, ...params },
      fallbackMessage: "فشل تحميل سجلات الإعدادات",
    })
    return data.rows ?? []
  }

  async get<T = EntityPayload>(entity: SettingsEntity, id: string): Promise<T | null> {
    const data = await apiClient.get<EntityResponse<T>>(`/api/settings/entities/${encodeURIComponent(id)}`, {
      query: { entity },
      fallbackMessage: "فشل تحميل سجل الإعدادات",
    })
    return data.row ?? null
  }

  async create<T = EntityPayload>(entity: SettingsEntity, values: EntityPayload): Promise<T> {
    const data = await apiClient.post<EntityResponse<T>>("/api/settings/entities", { entity, values }, {
      fallbackMessage: "فشل إنشاء سجل الإعدادات",
    })
    if (!data.row) throw new Error("الخادم لم يُرجع السجل بعد إنشائه")
    return data.row
  }

  async update<T = EntityPayload>(entity: SettingsEntity, id: string, values: EntityPayload): Promise<T> {
    const data = await apiClient.patch<EntityResponse<T>>(`/api/settings/entities/${encodeURIComponent(id)}`, { entity, values }, {
      fallbackMessage: "فشل تحديث سجل الإعدادات",
    })
    if (!data.row) throw new Error("الخادم لم يُرجع السجل بعد تحديثه")
    return data.row
  }

  async remove(entity: SettingsEntity, id: string): Promise<void> {
    await apiClient.delete(`/api/settings/entities/${encodeURIComponent(id)}`, {
      query: { entity },
      fallbackMessage: "فشل حذف سجل الإعدادات",
    })
  }

  async setDefault<T = EntityPayload>(entity: SettingsEntity, id: string): Promise<T> {
    const data = await apiClient.patch<EntityResponse<T>>(`/api/settings/entities/${encodeURIComponent(id)}`, {
      entity,
      setDefault: true,
      values: { is_default: true },
    }, {
      fallbackMessage: "فشل تعيين السجل الافتراضي",
    })
    if (!data.row) throw new Error("الخادم لم يُرجع السجل الافتراضي")
    return data.row
  }
}

export const SettingsEntityService = new SettingsEntityRepository()
