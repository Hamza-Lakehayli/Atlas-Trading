const madAmount = /^(?:0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/;

/** Parse a human-entered MAD amount without floating-point rounding. */
export function parseMadAmount(value: string): number | null {
  const raw = value.trim();
  if (raw.includes(",") && raw.includes(".")) return null;
  const normalized = raw.replace(",", ".");
  const match = madAmount.exec(normalized);
  if (!match) return null;
  const [whole, fractional = ""] = normalized.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fractional.padEnd(2, "0") || "0");
  if (minor <= BigInt(0) || minor > BigInt(2_147_483_647)) return null;
  return Number(minor);
}
