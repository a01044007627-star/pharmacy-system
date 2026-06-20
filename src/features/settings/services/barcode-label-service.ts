"use client"

import type { BarcodePaperSetting } from "@/features/settings/types"
import { SettingsCrudService, type SettingsRecordInput } from "./settings-crud-service"

const service = new SettingsCrudService<BarcodePaperSetting>("barcode-papers")

export const BarcodeLabelService = {
  getBarcodePapers: () => service.list(),
  getBarcodePaperById: (id: string) => service.get(id),
  saveBarcodePaper: (paper: SettingsRecordInput<BarcodePaperSetting>) => service.save(paper),
  deleteBarcodePaper: (id: string) => service.remove(id),
  setDefault: (id: string) => service.setDefault(id),
}
