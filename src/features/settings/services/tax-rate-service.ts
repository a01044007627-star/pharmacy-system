"use client"

import { SettingsEntityService } from "./settings-entity-service"

type LooseRow = any

export const TaxRateService = {
  getTaxRates: async (): Promise<any[]> => SettingsEntityService.list<any>("tax-rates"),
  getTaxRateById: async (id: string): Promise<any | null> => SettingsEntityService.get<any>("tax-rates", id),
  saveTaxRate: async (rate: LooseRow): Promise<any> => rate.id
    ? SettingsEntityService.update<any>("tax-rates", String(rate.id), rate)
    : SettingsEntityService.create<any>("tax-rates", rate),
  deleteTaxRate: (id: string) => SettingsEntityService.remove("tax-rates", id),

  getTaxGroups: async (): Promise<any[]> => SettingsEntityService.list<any>("tax-groups"),
  getTaxGroupById: async (id: string): Promise<any | null> => SettingsEntityService.get<any>("tax-groups", id),
  saveTaxGroup: async (group: LooseRow): Promise<any> => group.id
    ? SettingsEntityService.update<any>("tax-groups", String(group.id), group)
    : SettingsEntityService.create<any>("tax-groups", group),
  deleteTaxGroup: (id: string) => SettingsEntityService.remove("tax-groups", id),

  getTaxGroupMembers: async (): Promise<any[]> => SettingsEntityService.list<any>("tax-group-members"),
  addTaxGroupMember: async (member: LooseRow): Promise<any> => SettingsEntityService.create<any>("tax-group-members", member),
  deleteTaxGroupMember: (id: string) => SettingsEntityService.remove("tax-group-members", id),
}
