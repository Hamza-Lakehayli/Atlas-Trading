import { z } from "zod";
import { addCalendarDays, businessDate, calendarDayDifference } from "@/lib/dates/business-date";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const scopeId = z.uuid().or(z.literal("all"));

export const dashboardGranularities = ["daily", "weekly", "monthly"] as const;
export const dashboardComparisons = ["previous_period", "previous_year", "none"] as const;

const dashboardFiltersSchema = z.object({
  from: dateString,
  to: dateString,
  compare: z.enum(dashboardComparisons),
  warehouseId: scopeId,
  categoryId: scopeId,
  segment: z.enum(["Retail", "Hospitality", "Wholesale"]).or(z.literal("all")),
  granularity: z.enum(dashboardGranularities),
}).strict().superRefine((value, context) => {
  const days = calendarDayDifference(value.to, value.from);
  if (days < 0 || days > 365) context.addIssue({ code: "custom", path: ["to"], message: "Dashboard ranges must be ordered and no longer than 366 days." });
});

export type DashboardFilters = z.output<typeof dashboardFiltersSchema>;
export type DashboardRange = { from: string; to: string };

export function dashboardSupportsDso(filters: DashboardFilters) {
  return filters.warehouseId === "all" && filters.categoryId === "all";
}

export function parseDashboardFilters(input: Record<string, string | string[] | undefined>, referenceDate = businessDate()) {
  return dashboardFiltersSchema.safeParse({
    from: addCalendarDays(referenceDate, -29),
    to: referenceDate,
    compare: "previous_period",
    warehouseId: "all",
    categoryId: "all",
    segment: "all",
    granularity: "daily",
    ...input,
  });
}

export function dashboardComparisonRange(filters: DashboardFilters): DashboardRange | null {
  if (filters.compare === "none") return null;
  if (filters.compare === "previous_year") {
    const previous = (date: string) => {
      const value = new Date(`${date}T12:00:00.000Z`);
      const month = value.getUTCMonth();
      value.setUTCFullYear(value.getUTCFullYear() - 1);
      if (value.getUTCMonth() !== month) value.setUTCDate(0);
      return value.toISOString().slice(0, 10);
    };
    return { from: previous(filters.from), to: previous(filters.to) };
  }
  const duration = calendarDayDifference(filters.to, filters.from) + 1;
  const to = addCalendarDays(filters.from, -1);
  return { from: addCalendarDays(to, -(duration - 1)), to };
}

export function dashboardBuckets(range: DashboardRange, granularity: DashboardFilters["granularity"]) {
  const buckets = new Set<string>();
  const end = Date.parse(`${range.to}T00:00:00.000Z`);
  for (let cursor = Date.parse(`${range.from}T00:00:00.000Z`); cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor);
    if (granularity === "monthly") {
      buckets.add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`);
    } else if (granularity === "weekly") {
      const monday = new Date(cursor);
      const weekday = monday.getUTCDay();
      monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7));
      buckets.add(monday.toISOString().slice(0, 10));
    } else {
      buckets.add(date.toISOString().slice(0, 10));
    }
  }
  return [...buckets];
}

export function dashboardFilterHref(locale: string, filters: DashboardFilters, overrides: Partial<DashboardFilters> = {}) {
  const next = { ...filters, ...overrides };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    const fallback = key === "compare" ? "previous_period"
      : key === "warehouseId" || key === "categoryId" || key === "segment" ? "all"
        : key === "granularity" ? "daily" : undefined;
    if (value && value !== fallback) query.set(key, value);
  }
  const serialized = query.toString();
  return `/${locale}/dashboard${serialized ? `?${serialized}` : ""}`;
}
