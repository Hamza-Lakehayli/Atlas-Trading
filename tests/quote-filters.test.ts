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

  it("rejects malformed, repeated, unsupported, and excessive parameters", () => {
    expect(parseQuoteFilters({ status: "pending" }).success).toBe(false);
    expect(parseQuoteFilters({ page: "0" }).success).toBe(false);
    expect(parseQuoteFilters({ page: "1001" }).success).toBe(false);
    expect(parseQuoteFilters({ q: "x".repeat(81) }).success).toBe(false);
    expect(parseQuoteFilters({ q: ["one", "two"] }).success).toBe(false);
    expect(parseQuoteFilters({ ignored: "value" }).success).toBe(false);
  });
});
