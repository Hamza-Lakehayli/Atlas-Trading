import { getTranslations } from "next-intl/server";
import { ArrowDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import type { listProducts } from "@/server/queries/products";

type ProductRows = Awaited<ReturnType<typeof listProducts>>["rows"];

export async function ProductTable({ products, locale, showPrices }: { products: ProductRows; locale: string; showPrices: boolean }) {
  const t = await getTranslations("dashboard");
  return <div className="table-frame">
    <div className="table-toolbar"><div className="table-filter"><span className="filter-dot" /> All products <span className="filter-count">{products.length}</span></div><span className="table-context">Showing seeded catalogue records</span></div>
    <div className="table-scroll"><table className="product-table">
      <thead><tr><th><span>{t("sku")}</span><ArrowDown size={12} /></th><th>{t("product")}</th><th>{t("category")}</th>{showPrices && <th className="align-right">{t("price")}</th>}<th className="align-right">{t("stock")}</th><th>{t("status")}</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{products.map((product, index) => {
        const low = product.quantityOnHand <= product.reorderPoint;
        return <tr key={product.id}>
          <td><span className="sku-code">{product.sku}</span></td>
          <td><div className="product-name"><span className={`product-swatch swatch-${index % 5}`} />{product.name}</div></td>
          <td><span className="category-tag">{product.category}</span></td>
          {showPrices && <td className="align-right money-cell">{product.unitPriceMinor === null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 0 }).format(product.unitPriceMinor / 100)}</td>}
          <td className="align-right quantity-cell">{product.quantityOnHand.toLocaleString(locale)} <small>units</small></td>
          <td><span className={`stock-badge ${low ? "stock-low" : "stock-healthy"}`}><i />{low ? t("low") : t("healthy")}</span></td>
          <td><button className="row-menu" aria-label={`More actions for ${product.name}`} disabled><MoreHorizontal size={17} /></button></td>
        </tr>;
      })}</tbody>
    </table></div>
    {products.length === 0 && <div className="table-empty">{t("empty")}</div>}
    <div className="table-pagination"><span>{t("rows", { count: products.length })}</span><div><button aria-label="Previous page" disabled><ChevronLeft size={16} /></button><span className="page-indicator">1</span><button aria-label="Next page" disabled><ChevronRight size={16} /></button></div></div>
  </div>;
}
