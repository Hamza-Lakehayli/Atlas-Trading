import { describe, expect, it } from "vitest";
import { addCalendarDays, businessDate, businessDateStart, calendarDayDifference } from "@/lib/dates/business-date";

describe("Africa/Casablanca business dates", () => {
  it("converts a business midnight to the matching calendar date", () => {
    for (const date of ["2026-01-15", "2026-04-19", "2026-11-08"]) {
      expect(businessDate(businessDateStart(date))).toBe(date);
    }
  });

  it("adds and compares calendar days without relying on local timezone", () => {
    expect(addCalendarDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(calendarDayDifference("2026-03-01", "2026-02-27")).toBe(2);
  });
});
