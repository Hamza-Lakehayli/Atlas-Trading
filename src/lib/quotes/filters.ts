import { z } from "zod";

export const quoteStatuses = ["draft", "sent", "accepted", "rejected", "converted"] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];

const quoteFiltersSchema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum(quoteStatuses).or(z.literal("expired")).or(z.literal("all")).default("all"),
  page: z.preprocess(
    (value) => value === undefined ? "1" : value,
    z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).pipe(z.number().int().max(1000)),
  ),
}).strict();

export type QuoteFilters = z.output<typeof quoteFiltersSchema>;

export function parseQuoteFilters(input: Record<string, string | string[] | undefined>) {
  return quoteFiltersSchema.safeParse(input);
}
