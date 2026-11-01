import { z } from "zod";

export const customerSegments = ["Retail", "Hospitality", "Wholesale"] as const;
export type CustomerSegment = (typeof customerSegments)[number];

const customerFiltersSchema = z.object({
  q: z.string().trim().max(80).default(""),
  segment: z.enum(customerSegments).or(z.literal("all")).default("all"),
  page: z.preprocess(
    (value) => value === undefined ? "1" : value,
    z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).pipe(z.number().int().max(1000)),
  ),
}).strict();

export type CustomerFilters = z.output<typeof customerFiltersSchema>;

export function parseCustomerFilters(input: Record<string, string | string[] | undefined>) {
  return customerFiltersSchema.safeParse(input);
}
