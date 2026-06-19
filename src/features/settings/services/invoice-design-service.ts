"use client"

import { SettingsEntityService } from "./settings-entity-service"

type LooseRow = any

export const InvoiceDesignService = {
  async getInvoiceDesigns(): Promise<any[]> {
    return SettingsEntityService.list<any>("invoice-designs")
  },
  async getInvoiceDesignById(id: string): Promise<any | null> {
    return SettingsEntityService.get<any>("invoice-designs", id)
  },
  async saveInvoiceDesign(design: LooseRow): Promise<any | null> {
    return design.id
      ? SettingsEntityService.update<any>("invoice-designs", String(design.id), design)
      : SettingsEntityService.create<any>("invoice-designs", design)
  },
  async deleteInvoiceDesign(id: string): Promise<void> {
    await SettingsEntityService.remove("invoice-designs", id)
  },
  async setDefault(id: string): Promise<void> {
    await SettingsEntityService.setDefault("invoice-designs", id)
  },
}
