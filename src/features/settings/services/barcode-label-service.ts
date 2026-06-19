"use client"

import { SettingsEntityService } from "./settings-entity-service"

type LooseRow = any

export const BarcodeLabelService = {
  async getBarcodePapers(): Promise<any[]> {
    return SettingsEntityService.list<any>("barcode-papers")
  },
  async getBarcodePaperById(id: string): Promise<any | null> {
    return SettingsEntityService.get<any>("barcode-papers", id)
  },
  async saveBarcodePaper(paper: LooseRow): Promise<any | null> {
    return paper.id
      ? SettingsEntityService.update<any>("barcode-papers", String(paper.id), paper)
      : SettingsEntityService.create<any>("barcode-papers", paper)
  },
  async deleteBarcodePaper(id: string): Promise<void> {
    await SettingsEntityService.remove("barcode-papers", id)
  },
  async setDefault(id: string): Promise<void> {
    await SettingsEntityService.setDefault("barcode-papers", id)
  },
}
