export const appRoles = ["admin", "sales_manager", "warehouse", "accountant", "viewer"] as const;
export type AppRole = (typeof appRoles)[number];

export const permissionMatrix = {
  admin: ["dashboard:sales:read", "dashboard:finance:read", "orders:read", "orders:write", "orders:ship", "orders:invoice", "inventory:read", "inventory:adjust", "inventory:transfer", "invoices:read", "payments:read", "payments:record", "users:manage", "audit:read", "simulation:control"],
  sales_manager: ["dashboard:sales:read", "dashboard:finance:read", "orders:read", "orders:write", "orders:invoice", "inventory:read", "invoices:read", "payments:read"],
  warehouse: ["dashboard:sales:read", "orders:read", "orders:ship", "inventory:read", "inventory:adjust", "inventory:transfer"],
  accountant: ["dashboard:sales:read", "dashboard:finance:read", "orders:read", "orders:invoice", "inventory:read", "invoices:read", "payments:read", "payments:record"],
  viewer: ["dashboard:sales:read", "dashboard:finance:read", "inventory:read", "invoices:read"],
} as const satisfies Record<AppRole, readonly string[]>;

export type Permission = (typeof permissionMatrix)[AppRole][number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (appRoles as readonly string[]).includes(value);
}

export function can(role: AppRole, permission: string): boolean {
  return (permissionMatrix[role] as readonly string[]).includes(permission);
}
