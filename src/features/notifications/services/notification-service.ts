import { createClient } from "@/lib/supabase/client"
import type { NotificationRow, DeletedNotificationRow, NotifType } from "@/types/notifications"

export interface NewNotifInput {
  title: string
  description?: string
  notif_type: NotifType
  href?: string
}

async function getUserId(): Promise<string | null> {
  const { data: { session } } = await createClient().auth.getSession()
  return session?.user?.id ?? null
}

export const NotificationService = {
  async fetch(): Promise<NotificationRow[]> {
    const userId = await getUserId()
    if (!userId) return []
    const { data } = await createClient()
      .from("pharmacy_inapp_notifications")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200)
    return data ?? []
  },

  async insert(input: NewNotifInput): Promise<NotificationRow | null> {
    const userId = await getUserId()
    if (!userId) return null
    const { data } = await createClient()
      .from("pharmacy_inapp_notifications")
      .insert({ user_id: userId, title: input.title, description: input.description ?? "", notif_type: input.notif_type, href: input.href ?? null })
      .select()
      .single()
    return data
  },

  async markRead(id: string): Promise<void> {
    await createClient()
      .from("pharmacy_inapp_notifications")
      .update({ read: true })
      .eq("id", id)
  },

  async markAllRead(): Promise<void> {
    const userId = await getUserId()
    if (!userId) return
    await createClient()
      .from("pharmacy_inapp_notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .is("deleted_at", null)
  },

  async delete(id: string): Promise<void> {
    await createClient()
      .from("pharmacy_inapp_notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
  },

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await createClient()
      .from("pharmacy_inapp_notifications")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids)
  },

  async clearAll(): Promise<void> {
    const userId = await getUserId()
    if (!userId) return
    await createClient()
      .from("pharmacy_inapp_notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("deleted_at", null)
  },

  async getById(id: string): Promise<NotificationRow | null> {
    const { data } = await createClient()
      .from("pharmacy_inapp_notifications")
      .select("*")
      .eq("id", id)
      .single()
    return data
  },

  async fetchDeleted(): Promise<DeletedNotificationRow[]> {
    const userId = await getUserId()
    if (!userId) return []
    const { data } = await createClient()
      .from("pharmacy_inapp_deleted_notifications")
      .select("*")
      .eq("user_id", userId)
      .order("deleted_at", { ascending: false })
      .limit(200)
    return data ?? []
  },
}
