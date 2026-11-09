import type { DashboardFilters, DashboardRange } from "@/lib/dashboard/filters";

type InvoiceDimension = { customerId?: string; productId?: string; categoryId?: string };

export function dashboardInvoiceHref(
  locale: string,
  filters: DashboardFilters,
  range: DashboardRange = { from: filters.from, to: filters.to },
  dimension: InvoiceDimension = {},
) {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (filters.warehouseId !== "all") query.set("warehouseId", filters.warehouseId);
  if (filters.categoryId !== "all") query.set("categoryId", filters.categoryId);
  if (filters.segment !== "all") query.set("segment", filters.segment);
  if (dimension.customerId) query.set("customerId", dimension.customerId);
  if (dimension.productId) query.set("productId", dimension.productId);
  if (dimension.categoryId) query.set("categoryId", dimension.categoryId);
  return `/${locale}/sales/invoices?${query}`;
}

export function topRevenueInvoiceHref(locale: string, filters: DashboardFilters, kind: "customer" | "product", id: string) {
  return dashboardInvoiceHref(locale, filters, undefined, kind === "customer" ? { customerId: id } : { productId: id });
}
