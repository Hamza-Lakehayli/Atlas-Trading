import { describe, expect, it } from "vitest";
import { parseQuoteFilters } from "@/lib/quotes/filters";

describe("quote directory URL filters", () => {
  it("uses defaults for an unfiltered quote ledger", () => {
    expect(parseQuoteFilters({})).toEqual({ success: true, data: { q: "", status: "all", page: 1 } });
  });

  it("trims the search and parses supported statuses and pages", () => {
    expect(parseQuoteFilters({ q: " QT-2026 ", status: "accepted", page: "3" })).toEqual({
      success: true,
      data: { q: "QT-2026", status: "accepted", page: 3 },
    });
    expect(parseQuoteFilters({ status: "expired" }).success).toBe(true);
  });

  it("keeps dashboard cohort dates on quote drill-downs", () => {
    expect(parseQuoteFilters({ from: "2026-10-01", to: "2026-10-31", status: "converted" })).toMatchObject({
      success: true,
      data: { from: "2026-10-01", to: "2026-10-31", status: "converted" },
    });
    expect(parseQuoteFilters({ from: "2026-10-01" }).success).toBe(false);
    expect(parseQuoteFilters({ from: "2026-10-30", to: "2026-10-01" }).success).toBe(false);
    expect(parseQuoteFilters({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(parseQuoteFilters({ funnelStage: "paid" })).toMatchObject({ success: true, data: { funnelStage: "paid" } });
    expect(parseQuoteFilters({ funnelStage: "in-transit" }).success).toBe(false);
  });

  it("rejects malformed, repeated, unsupported, and excessive parameters", () => {
    expect(parseQuoteFilters({ status: "pending" }).success).toBe(false);
    expect(parseQuoteFilters({ page: "0" }).success).toBe(false);
    expect(parseQuoteFilters({ page: "1001" }).success).toBe(false);
    expect(parseQuoteFilters({ q: "x".repeat(81) }).success).toBe(false);
    expect(parseQuoteFilters({ q: ["one", "two"] }).success).toBe(false);
    expect(parseQuoteFilters({ ignored: "value" }).success).toBe(false);
  });

  it("accepts blank optional controls from the native GET filter form", () => {
    expect(parseQuoteFilters({
      q: "Atlas", status: "all", from: "", to: "", warehouseId: "", categoryId: "", segment: "", page: "1",
    })).toMatchObject({ success: true, data: { q: "Atlas", status: "all", page: 1 } });
  });
});
