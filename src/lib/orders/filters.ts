import { z } from "zod";
import { emptyQueryValuesToUndefined } from "@/lib/filters/query";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const orderStatuses = ["draft", "confirmed", "shipped", "invoiced", "paid", "cancelled"] as const;
export const orderSorts = ["orderDate", "orderNumber", "customer", "status", "total"] as const;
const uuid = z.uuid();

const schema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum(orderStatuses).or(z.literal("all")).default("all"),
  dateBasis: z.enum(["orderDate", "confirmedAt"]).default("orderDate"),
  from: dateString.optional(),
  to: dateString.optional(),
  customerId: uuid.optional(),
  warehouseId: uuid.optional(),
  categoryId: uuid.optional(),
  segment: z.enum(["Retail", "Hospitality", "Wholesale"]).optional(),
  sort: z.enum(orderSorts).default("orderDate"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.preprocess((value) => value === undefined ? "1" : value,
    z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).pipe(z.number().int().max(1000))),
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) {
    context.addIssue({ code: "custom", path: [value.from ? "to" : "from"], message: "Both order dates are required." });
  }
  if (value.from && value.to) {
    const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
    if (days < 0 || days > 365) context.addIssue({ code: "custom", path: ["to"], message: "Choose a date range of 366 days or fewer." });
  }
});

export type OrderFilters = z.output<typeof schema>;

export function parseOrderFilters(input: Record<string, string | string[] | undefined>) {
  return schema.safeParse(emptyQueryValuesToUndefined(input));
}
