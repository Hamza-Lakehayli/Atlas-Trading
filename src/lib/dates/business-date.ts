export function businessDate(value: Date = new Date(), timeZone = "Africa/Casablanca") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isDateExpired(validUntil: string, asOf: Date = new Date()) {
  return validUntil < businessDate(asOf);
}

export function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Convert a calendar date's midnight in a business timezone to a UTC instant. */
export function businessDateStart(value: string, timeZone = "Africa/Casablanca") {
  const [year, month, day] = value.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  let candidate = targetUtc;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const adjustment = targetUtc - localAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

export function calendarDayDifference(later: string, earlier: string) {
  const laterUtc = Date.parse(`${later}T00:00:00.000Z`);
  const earlierUtc = Date.parse(`${earlier}T00:00:00.000Z`);
  return Math.round((laterUtc - earlierUtc) / 86_400_000);
}
