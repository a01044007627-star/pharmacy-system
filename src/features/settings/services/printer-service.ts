"use client"

import { SettingsEntityService } from "./settings-entity-service"

type LooseRow = any

export const PrinterService = {
  async getPrinters(): Promise<any[]> {
    return SettingsEntityService.list<any>("receipt-printers")
  },
  async getPrinterById(id: string): Promise<any | null> {
    return SettingsEntityService.get<any>("receipt-printers", id)
  },
  async savePrinter(printer: LooseRow): Promise<any | null> {
    return printer.id
      ? SettingsEntityService.update<any>("receipt-printers", String(printer.id), printer)
      : SettingsEntityService.create<any>("receipt-printers", printer)
  },
  async deletePrinter(id: string): Promise<void> {
    await SettingsEntityService.remove("receipt-printers", id)
  },
  async setDefault(id: string): Promise<void> {
    await SettingsEntityService.setDefault("receipt-printers", id)
  },
}
