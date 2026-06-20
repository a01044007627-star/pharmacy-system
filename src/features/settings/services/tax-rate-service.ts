"use client"

import { SettingsCrudService, type SettingsRecordInput } from "./settings-crud-service"

export interface TaxRateRecord {
  id: string
  pharmacy_id: string
  name: string
  rate: number
  is_active: boolean
}

export interface TaxGroupRecord {
  id: string
  pharmacy_id: string
  name: string
  description?: string
  is_active: boolean
}

export interface TaxGroupMemberRecord {
  id: string
  pharmacy_id: string
  group_id: string
  tax_rate_id: string
}

const taxRates = new SettingsCrudService<TaxRateRecord>("tax-rates")
const taxGroups = new SettingsCrudService<TaxGroupRecord>("tax-groups")
const taxGroupMembers = new SettingsCrudService<TaxGroupMemberRecord>("tax-group-members")

export const TaxRateService = {
  getTaxRates: () => taxRates.list(),
  getTaxRateById: (id: string) => taxRates.get(id),
  saveTaxRate: (rate: SettingsRecordInput<TaxRateRecord>) => taxRates.save(rate),
  deleteTaxRate: (id: string) => taxRates.remove(id),

  getTaxGroups: () => taxGroups.list(),
  getTaxGroupById: (id: string) => taxGroups.get(id),
  saveTaxGroup: (group: SettingsRecordInput<TaxGroupRecord>) => taxGroups.save(group),
  deleteTaxGroup: (id: string) => taxGroups.remove(id),

  getTaxGroupMembers: () => taxGroupMembers.list(),
  addTaxGroupMember: (member: SettingsRecordInput<TaxGroupMemberRecord>) => taxGroupMembers.save(member),
  deleteTaxGroupMember: (id: string) => taxGroupMembers.remove(id),
}
