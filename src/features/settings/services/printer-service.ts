"use client"

import type { ReceiptPrinter } from "@/features/settings/types"
import { SettingsCrudService, type SettingsRecordInput } from "./settings-crud-service"

const service = new SettingsCrudService<ReceiptPrinter>("receipt-printers")

export const PrinterService = {
  getPrinters: () => service.list(),
  getPrinterById: (id: string) => service.get(id),
  savePrinter: (printer: SettingsRecordInput<ReceiptPrinter>) => service.save(printer),
  deletePrinter: (id: string) => service.remove(id),
  setDefault: (id: string) => service.setDefault(id),
}
