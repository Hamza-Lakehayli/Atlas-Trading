import { z } from "zod";
import { emptyQueryValuesToUndefined } from "@/lib/filters/query";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const uuid = z.uuid();

export const invoiceStatuses = ["unpaid", "partial", "paid", "overdue"] as const;
export const invoiceSorts = ["issuedAt", "dueDate", "invoiceNumber", "customer", "total"] as const;
export const receivableAgingBuckets = ["not_due", "1-30", "31-60", "61-90", "91-plus"] as const;

const invoiceFiltersSchema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum(invoiceStatuses).or(z.literal("all")).default("all"),
  from: dateString.optional(),
  to: dateString.optional(),
  asOf: dateString.optional(),
  warehouseId: uuid.optional(),
  categoryId: uuid.optional(),
  customerId: uuid.optional(),
  productId: uuid.optional(),
  segment: z.enum(["Retail", "Hospitality", "Wholesale"]).optional(),
  aging: z.enum(receivableAgingBuckets).optional(),
  sort: z.enum(invoiceSorts).default("issuedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.preprocess(
    (value) => value === undefined ? "1" : value,
    z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).pipe(z.number().int().max(1000)),
  ),
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) {
    context.addIssue({ code: "custom", path: [value.from ? "to" : "from"], message: "Both range dates are required." });
  }
  if (value.from && value.to) {
    const days = (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) / 86_400_000;
    if (days < 0 || days > 365) context.addIssue({ code: "custom", path: ["to"], message: "Choose a date range of 366 days or fewer." });
  }
});

export type InvoiceFilters = z.output<typeof invoiceFiltersSchema>;

export function parseInvoiceFilters(input: Record<string, string | string[] | undefined>) {
  return invoiceFiltersSchema.safeParse(emptyQueryValuesToUndefined(input));
}
