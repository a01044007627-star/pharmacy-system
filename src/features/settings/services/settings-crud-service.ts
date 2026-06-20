"use client"

import {
  SettingsEntityService,
  type EntityPayload,
  type SettingsEntity,
  type SettingsEntityRepository,
} from "./settings-entity-service"

export type SettingsRecord = { id: string }
export type SettingsRecordInput<T extends SettingsRecord> = Partial<Omit<T, "id">> & { id?: string }

export class SettingsCrudService<T extends SettingsRecord> {
  constructor(
    private readonly entity: SettingsEntity,
    private readonly repository: SettingsEntityRepository = SettingsEntityService,
  ) {}

  list() {
    return this.repository.list<T>(this.entity)
  }

  get(id: string) {
    return this.repository.get<T>(this.entity, id)
  }

  save(input: SettingsRecordInput<T>) {
    const payload = { ...input } as EntityPayload
    return input.id
      ? this.repository.update<T>(this.entity, String(input.id), payload)
      : this.repository.create<T>(this.entity, payload)
  }

  remove(id: string) {
    return this.repository.remove(this.entity, id)
  }

  setDefault(id: string) {
    return this.repository.setDefault<T>(this.entity, id)
  }
}
