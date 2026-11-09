import { describe, expect, it } from "vitest";
import { dashboardComparisonRange, dashboardSupportsDso, parseDashboardFilters } from "@/lib/dashboard/filters";
import { calculateDso } from "@/lib/dashboard/metrics";

describe("executive dashboard URL filters", () => {
  it("defaults to the last 30 days and keeps supported dimensions", () => {
    const parsed = parseDashboardFilters({}, "2026-11-08");
    expect(parsed).toEqual({
      success: true,
      data: {
        from: "2026-10-10", to: "2026-11-08", compare: "previous_period",
        warehouseId: "all", categoryId: "all", segment: "all", granularity: "daily",
      },
    });
    if (parsed.success) expect(dashboardComparisonRange(parsed.data)).toEqual({ from: "2026-09-10", to: "2026-10-09" });
  });

  it("supports prior-year comparisons and rejects unsupported or expensive ranges", () => {
    const priorYear = parseDashboardFilters({ from: "2026-01-01", to: "2026-01-31", compare: "previous_year" });
    expect(priorYear.success).toBe(true);
    if (priorYear.success) expect(dashboardComparisonRange(priorYear.data)).toEqual({ from: "2025-01-01", to: "2025-01-31" });
    const leapDay = parseDashboardFilters({ from: "2024-02-29", to: "2024-02-29", compare: "previous_year" });
    expect(leapDay.success).toBe(true);
    if (leapDay.success) expect(dashboardComparisonRange(leapDay.data)).toEqual({ from: "2023-02-28", to: "2023-02-28" });
    expect(parseDashboardFilters({ from: "2024-01-01", to: "2026-01-01" }).success).toBe(false);
    expect(parseDashboardFilters({ warehouseId: "not-a-uuid" }).success).toBe(false);
    expect(parseDashboardFilters({ granularity: "hourly" }).success).toBe(false);
    expect(parseDashboardFilters({ q: "ignored" }).success).toBe(false);
  });

  it("marks DSO unavailable for warehouse/category scopes without a receivables allocation model", () => {
    const all = parseDashboardFilters({}, "2026-11-08");
    const category = parseDashboardFilters({ categoryId: "123e4567-e89b-42d3-a456-426614174000" }, "2026-11-08");
    const warehouse = parseDashboardFilters({ warehouseId: "123e4567-e89b-42d3-a456-426614174000" }, "2026-11-08");
    const segment = parseDashboardFilters({ segment: "Retail" }, "2026-11-08");
    expect(all.success && dashboardSupportsDso(all.data)).toBe(true);
    expect(category.success && dashboardSupportsDso(category.data)).toBe(false);
    expect(warehouse.success && dashboardSupportsDso(warehouse.data)).toBe(false);
    expect(segment.success && dashboardSupportsDso(segment.data)).toBe(true);
    if (all.success && segment.success && category.success) {
      expect(calculateDso({ filters: segment.data, receivablesMinor: 25_000, revenueMinor: 100_000, periodDays: 30 })).toBe(7.5);
      expect(calculateDso({ filters: category.data, receivablesMinor: 25_000, revenueMinor: 20_000, periodDays: 30 })).toBeNull();
      expect(calculateDso({ filters: all.data, receivablesMinor: 0, revenueMinor: 0, periodDays: 30 })).toBeNull();
    }
  });
});
