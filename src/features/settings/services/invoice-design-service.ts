"use client"

import type { InvoiceDesign } from "@/features/settings/types"
import { SettingsCrudService, type SettingsRecordInput } from "./settings-crud-service"

const service = new SettingsCrudService<InvoiceDesign>("invoice-designs")

export const InvoiceDesignService = {
  getInvoiceDesigns: () => service.list(),
  getInvoiceDesignById: (id: string) => service.get(id),
  saveInvoiceDesign: (design: SettingsRecordInput<InvoiceDesign>) => service.save(design),
  deleteInvoiceDesign: (id: string) => service.remove(id),
  setDefault: (id: string) => service.setDefault(id),
}
