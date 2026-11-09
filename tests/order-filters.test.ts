import { describe, expect, it } from "vitest";
import { parseOrderFilters } from "@/lib/orders/filters";

describe("sales order URL filters", () => {
  it("defaults to the most recent orders sorted newest first", () => {
    expect(parseOrderFilters({})).toEqual({
      success: true,
      data: { q: "", status: "all", dateBasis: "orderDate", sort: "orderDate", direction: "desc", page: 1 },
    });
  });

  it("preserves supported search, status, date and sort controls", () => {
    expect(parseOrderFilters({
      q: " SO-2026 ", status: "shipped", dateBasis: "confirmedAt", from: "2026-10-01", to: "2026-10-31",
      sort: "customer", direction: "asc", page: "2",
    })).toMatchObject({ success: true, data: { q: "SO-2026", status: "shipped", dateBasis: "confirmedAt", sort: "customer", direction: "asc", page: 2 } });
  });

  it("rejects malformed dates, unsupported filters and repeated values", () => {
    expect(parseOrderFilters({ from: "2026-10-01" }).success).toBe(false);
    expect(parseOrderFilters({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(parseOrderFilters({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(parseOrderFilters({ status: "open" }).success).toBe(false);
    expect(parseOrderFilters({ page: ["1", "2"] }).success).toBe(false);
    expect(parseOrderFilters({ sortBy: "evil" }).success).toBe(false);
    expect(parseOrderFilters({ custom: "" }).success).toBe(false);
  });

  it("accepts blank optional controls from the native GET filter form", () => {
    expect(parseOrderFilters({
      q: "Atlas", status: "all", dateBasis: "orderDate", from: "", to: "",
      customerId: "", warehouseId: "", categoryId: "", segment: "",
      sort: "orderDate", direction: "desc", page: "1",
    })).toMatchObject({ success: true, data: { q: "Atlas", status: "all", dateBasis: "orderDate" } });
  });
});
