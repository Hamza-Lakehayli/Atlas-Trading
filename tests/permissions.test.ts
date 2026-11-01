import { describe, expect, it } from "vitest";
import { appRoles, can, isAppRole, permissionMatrix } from "@/server/auth/permissions";

describe("application role permissions", () => {
  it("defines the five demo roles", () => {
    expect(appRoles).toEqual(["admin", "sales_manager", "warehouse", "accountant", "viewer"]);
  });

  it("allows warehouse users to read stock and ship, but not read finance", () => {
    expect(can("warehouse", "inventory:read")).toBe(true);
    expect(can("warehouse", "orders:ship")).toBe(true);
    expect(can("warehouse", "dashboard:finance:read")).toBe(false);
    expect(can("warehouse", "invoices:read")).toBe(false);
  });

  it("separates sales, warehouse, invoicing, and payment responsibilities", () => {
    expect(can("sales_manager", "orders:write")).toBe(true);
    expect(can("sales_manager", "orders:invoice")).toBe(true);
    expect(can("sales_manager", "orders:ship")).toBe(false);
    expect(can("warehouse", "orders:ship")).toBe(true);
    expect(can("warehouse", "orders:invoice")).toBe(false);
    expect(can("accountant", "orders:invoice")).toBe(true);
    expect(can("accountant", "payments:record")).toBe(true);
  });

  it("keeps viewer access read-only and admin access broad", () => {
    expect(can("viewer", "orders:write")).toBe(false);
    expect(can("viewer", "payments:record")).toBe(false);
    expect(can("admin", "payments:record")).toBe(true);
    expect(can("admin", "users:manage")).toBe(true);
  });

  it("fails closed for unknown role names", () => {
    expect(isAppRole("root")).toBe(false);
    expect(Object.keys(permissionMatrix)).toHaveLength(5);
  });
});
