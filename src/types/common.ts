export type UUID = string
export type Timestamp = string

export interface BaseEntity {
  id: UUID
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SortConfig {
  key: string
  direction: "asc" | "desc"
}

export interface SelectOption {
  value: string
  label: string
}
