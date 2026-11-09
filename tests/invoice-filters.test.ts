import { describe, expect, it } from "vitest";
import { parseInvoiceFilters } from "@/lib/invoices/filters";

describe("invoice URL filters", () => {
  it("defaults to recent issues sorted newest first", () => {
    expect(parseInvoiceFilters({})).toEqual({
      success: true,
      data: { q: "", status: "all", sort: "issuedAt", direction: "desc", page: 1 },
    });
  });

  it("preserves dashboard drill-down dimensions and as-of dates", () => {
    expect(parseInvoiceFilters({
      from: "2026-10-01",
      to: "2026-10-31",
      asOf: "2026-10-31",
      status: "overdue",
      aging: "31-60",
      sort: "dueDate",
      direction: "asc",
      page: "2",
    })).toMatchObject({ success: true, data: { status: "overdue", aging: "31-60", sort: "dueDate", direction: "asc", page: 2 } });
  });

  it("rejects invalid ranges, repeated values, and unknown filters", () => {
    expect(parseInvoiceFilters({ from: "2026-10-01" }).success).toBe(false);
    expect(parseInvoiceFilters({ from: "2026-11-01", to: "2026-10-01" }).success).toBe(false);
    expect(parseInvoiceFilters({ from: "2025-01-01", to: "2026-01-02" }).success).toBe(false);
    expect(parseInvoiceFilters({ status: "pending" }).success).toBe(false);
    expect(parseInvoiceFilters({ page: ["1", "2"] }).success).toBe(false);
    expect(parseInvoiceFilters({ custom: "ignored" }).success).toBe(false);
    expect(parseInvoiceFilters({ custom: "" }).success).toBe(false);
  });

  it("accepts blank optional controls from the native GET filter form", () => {
    expect(parseInvoiceFilters({
      q: "Atlas", status: "all", from: "", to: "", asOf: "", warehouseId: "",
      categoryId: "", customerId: "", productId: "", segment: "", sort: "issuedAt",
      direction: "desc", page: "1",
    })).toMatchObject({ success: true, data: { q: "Atlas", status: "all", sort: "issuedAt" } });
  });
});
