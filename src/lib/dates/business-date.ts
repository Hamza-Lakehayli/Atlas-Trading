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
