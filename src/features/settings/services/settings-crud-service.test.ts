import { SettingsCrudService } from "./settings-crud-service"
import type { SettingsEntityRepository } from "./settings-entity-service"

type Row = { id: string; name: string }

function createRepositoryMock() {
  return {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setDefault: jest.fn(),
  }
}

describe("SettingsCrudService", () => {
  it("uses create for new records and update for existing records", async () => {
    const repository = createRepositoryMock()
    repository.create.mockResolvedValue({ id: "new", name: "جديد" })
    repository.update.mockResolvedValue({ id: "row-1", name: "معدل" })
    const service = new SettingsCrudService<Row>(
      "receipt-printers",
      repository as unknown as SettingsEntityRepository,
    )

    await service.save({ name: "جديد" })
    await service.save({ id: "row-1", name: "معدل" })

    expect(repository.create).toHaveBeenCalledWith("receipt-printers", { name: "جديد" })
    expect(repository.update).toHaveBeenCalledWith("receipt-printers", "row-1", { id: "row-1", name: "معدل" })
  })
})
