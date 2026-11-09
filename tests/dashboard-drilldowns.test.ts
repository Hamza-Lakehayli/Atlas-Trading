import { describe, expect, it } from "vitest";
import { parseDashboardFilters } from "@/lib/dashboard/filters";
import { topRevenueInvoiceHref } from "@/lib/dashboard/drilldowns";

describe("dashboard invoice drill-down URLs", () => {
  const filters = parseDashboardFilters({
    from: "2026-10-01", to: "2026-10-31", warehouseId: "123e4567-e89b-42d3-a456-426614174000",
    categoryId: "123e4567-e89b-42d3-a456-426614174001", segment: "Retail",
  });

  it("keeps customer and product dimensions distinct while preserving dashboard scope", () => {
    expect(filters.success).toBe(true);
    if (!filters.success) return;
    const customer = new URL(topRevenueInvoiceHref("en", filters.data, "customer", "123e4567-e89b-42d3-a456-426614174002"), "https://atlas.invalid");
    expect(customer.pathname).toBe("/en/sales/invoices");
    expect(customer.searchParams.get("customerId")).toBe("123e4567-e89b-42d3-a456-426614174002");
    expect(customer.searchParams.has("productId")).toBe(false);
    expect(customer.searchParams.get("warehouseId")).toBe(filters.data.warehouseId);
    expect(customer.searchParams.get("categoryId")).toBe(filters.data.categoryId);
    expect(customer.searchParams.get("segment")).toBe("Retail");

    const product = new URL(topRevenueInvoiceHref("fr", filters.data, "product", "123e4567-e89b-42d3-a456-426614174003"), "https://atlas.invalid");
    expect(product.pathname).toBe("/fr/sales/invoices");
    expect(product.searchParams.get("productId")).toBe("123e4567-e89b-42d3-a456-426614174003");
    expect(product.searchParams.has("customerId")).toBe(false);
  });
});
