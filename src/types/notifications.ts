export type NotifType = "warning" | "success" | "info" | "error"

export interface NotificationRow {
  id: string
  user_id: string
  title: string
  description: string
  notif_type: NotifType
  href: string | null
  read: boolean
  deleted_at: string | null
  created_at: string
}

export interface DeletedNotificationRow {
  id: string
  user_id: string
  original_id: string | null
  title: string
  description: string
  notif_type: string
  href: string | null
  was_read: boolean
  created_at: string
  deleted_at: string
  deleted_by: string
}
