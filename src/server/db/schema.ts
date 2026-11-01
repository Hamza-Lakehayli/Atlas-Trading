import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("organizations_name_uidx").on(table.name)]);

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  appRole: text("app_role").default("viewer").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  locale: text("locale").default("en").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("categories_org_name_uidx").on(table.organizationId, table.name)]);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unitCostMinor: integer("unit_cost_minor").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  reorderPoint: integer("reorder_point").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("products_org_sku_uidx").on(table.organizationId, table.sku),
  index("products_org_active_idx").on(table.organizationId, table.active),
  check("products_nonnegative_money_ck", sql`${table.unitCostMinor} >= 0 AND ${table.unitPriceMinor} >= 0`),
  check("products_nonnegative_reorder_point_ck", sql`${table.reorderPoint} >= 0`),
]);

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  segment: text("segment").notNull(),
  city: text("city").notNull(),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("customers_org_name_idx").on(table.organizationId, table.name)]);


export const stockLevels = pgTable("stock_levels", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  quantity: integer("quantity").notNull().default(0),
  averageUnitCostMinor: integer("average_unit_cost_minor").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("stock_levels_product_warehouse_uidx").on(table.productId, table.warehouseId),
  index("stock_levels_org_idx").on(table.organizationId),
  check("stock_levels_nonnegative_quantity_ck", sql`${table.quantity} >= 0`),
]);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("warehouses_org_name_uidx").on(table.organizationId, table.name)]);

export const salesOrders = pgTable("sales_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  orderNumber: text("order_number").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  status: text("status").notNull().default("draft"),
  orderDate: timestamp("order_date", { withTimezone: true }).defaultNow().notNull(),
  promisedDate: timestamp("promised_date", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sales_orders_org_number_uidx").on(table.organizationId, table.orderNumber),
  index("sales_orders_org_status_date_idx").on(table.organizationId, table.status, table.orderDate),
  index("sales_orders_customer_idx").on(table.organizationId, table.customerId, table.orderDate),
  check("sales_orders_status_ck", sql`${table.status} IN ('draft','confirmed','shipped','invoiced','paid','cancelled')`),
]);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").notNull().references(() => salesOrders.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  unitCostAtSaleMinor: integer("unit_cost_at_sale_minor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sales_order_lines_order_product_uidx").on(table.orderId, table.productId),
  index("sales_order_lines_org_order_idx").on(table.organizationId, table.orderId),
  check("sales_order_lines_quantity_ck", sql`${table.quantity} > 0`),
  check("sales_order_lines_price_ck", sql`${table.unitPriceMinor} >= 0`),
  check("sales_order_lines_cost_ck", sql`${table.unitCostAtSaleMinor} IS NULL OR ${table.unitCostAtSaleMinor} >= 0`),
]);

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  type: text("type").notNull(),
  quantity: integer("quantity").notNull(),
  unitCostMinor: integer("unit_cost_minor").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: uuid("reference_id").notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("stock_movements_org_product_date_idx").on(table.organizationId, table.productId, table.createdAt),
  index("stock_movements_reference_idx").on(table.organizationId, table.referenceType, table.referenceId),
  uniqueIndex("stock_movements_reference_product_uidx").on(table.organizationId, table.referenceType, table.referenceId, table.productId, table.warehouseId, table.type),
  check("stock_movements_type_ck", sql`${table.type} IN ('receipt','shipment','adjustment','transfer')`),
  check("stock_movements_quantity_ck", sql`${table.quantity} <> 0`),
  check("stock_movements_cost_ck", sql`${table.unitCostMinor} >= 0`),
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").notNull().references(() => salesOrders.id),
  number: text("number").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("unpaid"),
  totalMinor: integer("total_minor").notNull(),
  cogsMinor: integer("cogs_minor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("invoices_order_uidx").on(table.orderId),
  uniqueIndex("invoices_org_number_uidx").on(table.organizationId, table.number),
  index("invoices_org_due_status_idx").on(table.organizationId, table.dueDate, table.status),
  check("invoices_status_ck", sql`${table.status} IN ('unpaid','partial','paid')`),
  check("invoices_total_ck", sql`${table.totalMinor} > 0`),
  check("invoices_cogs_ck", sql`${table.cogsMinor} >= 0`),
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  amountMinor: integer("amount_minor").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  method: text("method").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("payments_org_invoice_date_idx").on(table.organizationId, table.invoiceId, table.paidAt),
  check("payments_amount_ck", sql`${table.amountMinor} > 0`),
  check("payments_method_ck", sql`${table.method} IN ('bank_transfer','cash','check','other')`),
]);

export const auditLogs = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: text("actor_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_log_org_entity_at_idx").on(table.organizationId, table.entityType, table.entityId, table.at)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: text("actor_id").notNull().references(() => users.id),
  operation: text("operation").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  resourceId: uuid("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("idempotency_org_actor_operation_key_uidx").on(table.organizationId, table.actorId, table.operation, table.key)]);
