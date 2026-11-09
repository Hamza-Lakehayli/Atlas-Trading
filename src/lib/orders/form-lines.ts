import { z } from "zod";

const uuid = z.uuid();
const orderLinesSchema = z.array(z.object({ productId: uuid, quantity: z.number().int().positive().max(999) })).min(1).max(50);

export function parseOrderLines(formData: FormData) {
  const productIds = formData.getAll("productId");
  const quantities = formData.getAll("quantity");
  if (productIds.length !== quantities.length || productIds.length > 50) return null;
  const lines: Array<{ productId: string; quantity: number }> = [];
  for (let index = 0; index < productIds.length; index += 1) {
    const productValue = productIds[index];
    const quantityValue = quantities[index];
    if (typeof productValue !== "string" || typeof quantityValue !== "string") return null;
    if (!productValue.trim() && !quantityValue.trim()) continue;
    const productId = uuid.safeParse(productValue);
    const quantity = z.coerce.number().int().positive().max(999).safeParse(quantityValue);
    if (!productId.success || !quantity.success) return null;
    lines.push({ productId: productId.data, quantity: quantity.data });
  }
  const parsed = orderLinesSchema.safeParse(lines);
  return parsed.success ? parsed.data : null;
}
