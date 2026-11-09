import { z } from "zod";
import { calendarDayDifference } from "@/lib/dates/business-date";
import { emptyQueryValuesToUndefined } from "@/lib/filters/query";

export const quoteStatuses = ["draft", "sent", "accepted", "rejected", "converted"] as const;
export const quoteFunnelStages = ["created", "sent", "accepted", "converted", "invoiced", "paid"] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const uuid = z.uuid();

const quoteFiltersSchema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum(quoteStatuses).or(z.literal("expired")).or(z.literal("all")).default("all"),
  funnelStage: z.enum(quoteFunnelStages).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  warehouseId: uuid.optional(),
  categoryId: uuid.optional(),
  segment: z.enum(["Retail", "Hospitality", "Wholesale"]).optional(),
  page: z.preprocess(
    (value) => value === undefined ? "1" : value,
    z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).pipe(z.number().int().max(1000)),
  ),
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) {
    context.addIssue({ code: "custom", path: [value.from ? "to" : "from"], message: "Both quote dates are required." });
  }
  if (value.from && value.to) {
    const days = calendarDayDifference(value.to, value.from);
    if (days < 0 || days > 365) context.addIssue({ code: "custom", path: ["to"], message: "Choose a date range of 366 days or fewer." });
  }
});

export type QuoteFilters = z.output<typeof quoteFiltersSchema>;

export function parseQuoteFilters(input: Record<string, string | string[] | undefined>) {
  return quoteFiltersSchema.safeParse(emptyQueryValuesToUndefined(input));
}
