"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Product = { id: string; sku: string; name: string };
type InitialLine = { productId: string; quantity: number };
type OrderLine = InitialLine & { key: number };

export function OrderLineFields({ products, initialLines = [], labels }: {
  products: Product[];
  initialLines?: InitialLine[];
  labels: { product: string; quantity: string; chooseProduct: string; addLine: string; additionalLine: string; removeLine: string };
}) {
  const [lines, setLines] = useState<OrderLine[]>(() => {
    const initial = initialLines.map((line, key) => ({ ...line, key }));
    return initial.length ? initial : [{ productId: "", quantity: 1, key: 0 }];
  });
  const [nextKey, setNextKey] = useState(Math.max(1, initialLines.length));

  function addLine() {
    if (lines.length >= 50) return;
    setLines((current) => [...current, { productId: "", quantity: 0, key: nextKey }]);
    setNextKey((key) => key + 1);
  }

  function removeLine(key: number) {
    if (lines.length <= 1) return;
    setLines((current) => current.filter((line) => line.key !== key));
  }

  return <div className="order-line-field-list">
    {lines.map((line, index) => <div className="order-line-field-row" key={line.key}>
      <label><span>{labels.product}{index > 0 ? ` · ${labels.additionalLine}` : ""}</span><select name="productId" defaultValue={line.productId} required={index === 0}>
        <option value="">{labels.chooseProduct}</option>
        {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
      </select></label>
      <label><span>{labels.quantity}</span><input name="quantity" type="number" min="1" max="999" defaultValue={line.quantity || ""} required={index === 0} /></label>
      {lines.length > 1 && <button className="order-line-remove" type="button" aria-label={`${labels.removeLine} ${index + 1}`} title={`${labels.removeLine} ${index + 1}`} onClick={() => removeLine(line.key)}><Trash2 size={14} /></button>}
    </div>)}
    {lines.length < 50 && <button className="order-line-add" type="button" onClick={addLine}><Plus size={14} /> {labels.addLine}</button>}
  </div>;
}
