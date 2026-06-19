export type PharmacyItemStatus = "active" | "inactive" | "draft" | "archived" | "deleted"
export type PharmacyItemKind = "stocked" | "service" | "digital" | "consignment" | "non-stocked" | string

export interface ItemUniqueKey {
  id: string
  type: "name" | "nameEn" | "barcode"
  value: string
}
