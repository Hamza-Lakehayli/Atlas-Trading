import { dashboardSupportsDso, type DashboardFilters } from "@/lib/dashboard/filters";

export function calculateDso(input: {
  filters: DashboardFilters;
  receivablesMinor: number;
  revenueMinor: number;
  periodDays: number;
}) {
  if (!dashboardSupportsDso(input.filters) || input.revenueMinor <= 0 || input.periodDays <= 0) return null;
  return input.receivablesMinor / input.revenueMinor * input.periodDays;
}
