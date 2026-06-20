"use client"

import { apiClient } from "@/lib/http/api-client"

export class InventoryItemApiService {
  getDetail<T>(itemId: string, pharmacyId?: string | null, signal?: AbortSignal) {
    return apiClient.get<T>(`/api/items/${encodeURIComponent(itemId)}`, {
      query: { pharmacy_id: pharmacyId },
      signal,
      timeoutMs: 18_000,
      retries: 1,
      fallbackMessage: "فشل تحميل الصنف",
    })
  }

  listBarcodePapers<T>(pharmacyId: string, signal?: AbortSignal) {
    return apiClient.get<{ rows?: T[] }>("/api/settings/entities", {
      query: { entity: "barcode-papers", pharmacy_id: pharmacyId },
      signal,
      timeoutMs: 18_000,
      retries: 1,
      fallbackMessage: "فشل تحميل إعدادات ورق الباركود",
    })
  }
}

export const inventoryItemService = new InventoryItemApiService()
