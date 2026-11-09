"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardFilters } from "@/lib/dashboard/filters";
import { topRevenueInvoiceHref } from "@/lib/dashboard/drilldowns";

type Data = {
  customers: Array<{ id: string; name: string; revenueMinor: number }>;
  products: Array<{ id: string; sku: string; name: string; revenueMinor: number }>;
};

function money(minor: number, locale: string, compact = false) {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "MAD", maximumFractionDigits: compact ? 1 : 2,
    notation: compact ? "compact" : "standard",
  }).format(minor / 100);
}

export function TopRevenueWidget({ data, filters, locale, labels, canDrillDown }: {
  data: Data; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean;
}) {
  const [kind, setKind] = useState<"customers" | "products">("customers");
  const rows = kind === "customers" ? data.customers : data.products;
  const max = Math.max(1, ...rows.map((row) => row.revenueMinor));

  return <section className="analytics-panel" aria-labelledby="top-revenue-title">
    <div className="analytics-panel-heading"><div><h2 id="top-revenue-title">{labels.topAccountsProducts}</h2><p>{labels.topAccountsProductsDescription}</p></div></div>
    <div className="top-revenue-toggle" role="group" aria-label={labels.topAccountsProducts}>
      <button type="button" aria-pressed={kind === "customers"} onClick={() => setKind("customers")}>{labels.topCustomers}</button>
      <button type="button" aria-pressed={kind === "products"} onClick={() => setKind("products")}>{labels.topProducts}</button>
    </div>
    <div className="top-revenue-list">{rows.slice(0, 10).map((row, index) => {
      const label = "sku" in row ? `${row.sku} · ${row.name}` : row.name;
      const href = topRevenueInvoiceHref(locale, filters, kind === "customers" ? "customer" : "product", row.id);
      const contents = <><span className="top-revenue-rank">{String(index + 1).padStart(2, "0")}</span><span className="top-revenue-name">{label}<i style={{ width: `${row.revenueMinor / max * 100}%` }} /></span><strong>{money(row.revenueMinor, locale, true)}</strong></>;
      return canDrillDown
        ? <Link key={row.id} href={href} className="top-revenue-row">{contents}</Link>
        : <span key={row.id} className="top-revenue-row">{contents}</span>;
    })}{!rows.length && <p className="analytics-empty">{labels.noChartData}</p>}</div>
    <details className="chart-data-table"><summary>{labels.viewData}</summary><div className="top-revenue-columns">
      <div className="table-scroll"><table><thead><tr><th>{labels.topCustomers}</th><th>{labels.revenue}</th></tr></thead><tbody>{data.customers.map((row) => <tr key={row.id}><td>{row.name}</td><td>{money(row.revenueMinor, locale)}</td></tr>)}</tbody></table></div>
      <div className="table-scroll"><table><thead><tr><th>{labels.topProducts}</th><th>{labels.revenue}</th></tr></thead><tbody>{data.products.map((row) => <tr key={row.id}><td>{row.sku} · {row.name}</td><td>{money(row.revenueMinor, locale)}</td></tr>)}</tbody></table></div>
    </div></details>
  </section>;
}
