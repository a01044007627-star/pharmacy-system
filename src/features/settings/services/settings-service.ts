"use client"

import { createClient } from "@/lib/supabase/client"
import type { SettingsRow, PharmacyProfile } from "../types"
import { notifySettingsUpdated } from "./app-settings-service"

async function getUserId(): Promise<string | null> {
  const { data: { session } } = await createClient().auth.getSession()
  return session?.user?.id ?? null
}

async function getPharmacyId(): Promise<string | null> {
  try {
    return localStorage.getItem("active-pharmacy-id")
  } catch {
    return null
  }
}

export const SettingsService = {
  async fetchAll(): Promise<SettingsRow[]> {
    const pharmacyId = await getPharmacyId()
    if (!pharmacyId) return []
    const { data } = await createClient()
      .from("pharmacy_settings")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .order("key", { ascending: true })
    return data ?? []
  },

  async get(key: string): Promise<string | null> {
    const pharmacyId = await getPharmacyId()
    if (!pharmacyId) return null
    const { data } = await createClient()
      .from("pharmacy_settings")
      .select("value")
      .eq("pharmacy_id", pharmacyId)
      .eq("key", key)
      .maybeSingle()
    return data?.value ?? null
  },

  async set(key: string, value: string, description?: string): Promise<void> {
    const userId = await getUserId()
    const pharmacyId = await getPharmacyId()
    if (!userId || !pharmacyId) return
    const existing = await createClient()
      .from("pharmacy_settings")
      .select("id")
      .eq("pharmacy_id", pharmacyId)
      .eq("key", key)
      .maybeSingle()
    if (existing.data) {
      await createClient()
        .from("pharmacy_settings")
        .update({ value, description: description ?? null, updated_at: new Date().toISOString() })
        .eq("id", existing.data.id)
    } else {
      await createClient()
        .from("pharmacy_settings")
        .insert({ pharmacy_id: pharmacyId, key, value, description: description ?? null })
    }
    notifySettingsUpdated()
  },

  async setMultiple(settings: { key: string; value: string; description?: string }[]): Promise<void> {
    const userId = await getUserId()
    const pharmacyId = await getPharmacyId()
    if (!userId || !pharmacyId || settings.length === 0) return
    for (const setting of settings) {
      await this.set(setting.key, setting.value, setting.description)
    }
    notifySettingsUpdated()
  },

  async fetchProfile(): Promise<PharmacyProfile | null> {
    const pharmacyId = await getPharmacyId()
    if (!pharmacyId) return null
    const { data } = await createClient()
      .from("pharmacies")
      .select("*")
      .eq("id", pharmacyId)
      .maybeSingle()
    return data as PharmacyProfile | null
  },

  async updateProfile(data: Partial<PharmacyProfile>): Promise<PharmacyProfile | null> {
    const userId = await getUserId()
    const pharmacyId = await getPharmacyId()
    if (!userId || !pharmacyId) return null
    const { data: updated } = await createClient()
      .from("pharmacies")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", pharmacyId)
      .select()
      .maybeSingle()
    return updated as PharmacyProfile | null
  },

  async delete(key: string): Promise<void> {
    const pharmacyId = await getPharmacyId()
    if (!pharmacyId) return
    await createClient()
      .from("pharmacy_settings")
      .delete()
      .eq("pharmacy_id", pharmacyId)
      .eq("key", key)
    notifySettingsUpdated()
  },

  async clearAll(): Promise<void> {
    const pharmacyId = await getPharmacyId()
    if (!pharmacyId) return
    await createClient()
      .from("pharmacy_settings")
      .delete()
      .eq("pharmacy_id", pharmacyId)
    notifySettingsUpdated()
  },
}
