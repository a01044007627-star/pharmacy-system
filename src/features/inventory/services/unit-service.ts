import { PHARMACY_UNIT_CATALOG } from "@/domain/inventory/units/unit-catalog"
import { unitPolicyService } from "@/domain/inventory/units/unit-policy"
import type { UnitDefinitionInput } from "@/domain/inventory/units/unit-types"
import type { UnitRepository } from "@/features/inventory/server/unit-repository"

export class UnitService {
  constructor(private readonly repository: UnitRepository) {}

  async list() {
    const units = await this.repository.list()
    return units.map((unit) => {
      const normalized = unitPolicyService.normalizeDefinition(unit)
      return {
        ...unit,
        ...normalized,
        id: unit.id,
        created_at: unit.created_at ?? null,
        updated_at: unit.updated_at ?? null,
        is_system: unit.is_system ?? false,
      }
    })
  }

  async create(input: UnitDefinitionInput) {
    const definition = unitPolicyService.normalizeDefinition(input)
    return this.repository.create(definition)
  }

  async update(id: string, input: UnitDefinitionInput) {
    if (!id.trim()) throw new Error("معرف الوحدة مطلوب")
    const definition = unitPolicyService.normalizeDefinition(input)
    const unit = await this.repository.update(id, definition)
    if (!unit) throw new Error("الوحدة غير موجودة")
    return unit
  }

  async delete(id: string) {
    if (!id.trim()) throw new Error("معرف الوحدة مطلوب")
    await this.repository.delete(id)
  }

  catalog() {
    return PHARMACY_UNIT_CATALOG
  }
}
