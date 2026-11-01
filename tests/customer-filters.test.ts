import { describe, expect, it } from "vitest";
import { parseCustomerFilters } from "@/lib/customers/filters";

describe("customer directory URL filters", () => {
  it("uses stable defaults for an unfiltered directory", () => {
    expect(parseCustomerFilters({})).toEqual({ success: true, data: { q: "", segment: "all", page: 1 } });
  });

  it("trims search, validates supported segments, and parses a bounded page", () => {
    expect(parseCustomerFilters({ q: "  Casablanca  ", segment: "Retail", page: "4" })).toEqual({
      success: true,
      data: { q: "Casablanca", segment: "Retail", page: 4 },
    });
  });

  it("rejects malformed and unsupported filters instead of silently dropping them", () => {
    expect(parseCustomerFilters({ segment: "Enterprise" }).success).toBe(false);
    expect(parseCustomerFilters({ page: "0" }).success).toBe(false);
    expect(parseCustomerFilters({ page: "1001" }).success).toBe(false);
    expect(parseCustomerFilters({ q: "a".repeat(81) }).success).toBe(false);
    expect(parseCustomerFilters({ q: ["one", "two"] }).success).toBe(false);
    expect(parseCustomerFilters({ ignored: "value" }).success).toBe(false);
  });
});
