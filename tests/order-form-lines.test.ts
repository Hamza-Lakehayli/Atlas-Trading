import { describe, expect, it } from "vitest";
import { parseOrderLines } from "@/lib/orders/form-lines";

describe("multi-line order forms", () => {
  it("parses multiple product and quantity controls while skipping untouched optional rows", () => {
    const form = new FormData();
    form.append("productId", "123e4567-e89b-42d3-a456-426614174000");
    form.append("quantity", "2");
    form.append("productId", "");
    form.append("quantity", "");
    form.append("productId", "123e4567-e89b-42d3-a456-426614174001");
    form.append("quantity", "7");
    expect(parseOrderLines(form)).toEqual([
      { productId: "123e4567-e89b-42d3-a456-426614174000", quantity: 2 },
      { productId: "123e4567-e89b-42d3-a456-426614174001", quantity: 7 },
    ]);
  });

  it("rejects unpaired, malformed, excessive, or empty order lines", () => {
    const unmatched = new FormData();
    unmatched.append("productId", "123e4567-e89b-42d3-a456-426614174000");
    expect(parseOrderLines(unmatched)).toBeNull();

    const invalidQuantity = new FormData();
    invalidQuantity.append("productId", "123e4567-e89b-42d3-a456-426614174000");
    invalidQuantity.append("quantity", "0");
    expect(parseOrderLines(invalidQuantity)).toBeNull();

    expect(parseOrderLines(new FormData())).toBeNull();
  });
});
