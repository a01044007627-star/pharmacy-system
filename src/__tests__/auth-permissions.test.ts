import { getPermissions, hasPermission, normalizeRole, roleAtLeast } from "@/lib/auth/permissions"

describe("auth permissions", () => {
  it("gives developer full system access", () => {
    expect(getPermissions("developer")).toContain("system:all")
    expect(hasPermission("developer", "developer:write")).toBe(true)
    expect(hasPermission("developer", "users:delete")).toBe(true)
  })

  it("keeps owner below developer but able to manage pharmacy users and branches", () => {
    expect(roleAtLeast("developer", "owner")).toBe(true)
    expect(roleAtLeast("owner", "developer")).toBe(false)
    expect(hasPermission("owner", "users:write")).toBe(true)
    expect(hasPermission("owner", "branches:write")).toBe(true)
    expect(hasPermission("owner", "developer:write")).toBe(false)
    expect(hasPermission("owner", "settings:system.write")).toBe(false)
    expect(hasPermission("owner", "roles:manage")).toBe(false)
  })

  it("limits cashier to sales and read-only inventory", () => {
    expect(hasPermission("cashier", "sales:write")).toBe(true)
    expect(hasPermission("cashier", "inventory:write")).toBe(false)
    expect(hasPermission("cashier", "users:write")).toBe(false)
  })

  it("does not allow custom permissions to grant developer-level access", () => {
    expect(hasPermission("cashier", "developer:write", ["system:all", "developer:write"])).toBe(false)
    expect(hasPermission("cashier", "sales:void", ["sales:void"])).toBe(true)
  })

  it("normalizes unknown roles to no-access", () => {
    expect(normalizeRole("bad-role")).toBe("no-access")
    expect(getPermissions("bad-role")).toHaveLength(0)
  })
})
