"use client";

import { useState } from "react";
import Link from "next/link";
import { dashboardBuckets, type DashboardFilters } from "@/lib/dashboard/filters";
import { dashboardInvoiceHref } from "@/lib/dashboard/drilldowns";

type Row = { month: string; categoryId: string; categoryName: string; revenueMinor: number };
const palette = ["#386e60", "#ba8843", "#657c91", "#9a6658", "#6f7a50", "#7f688f", "#397e83", "#a87542", "#546b78", "#986e68", "#607b69", "#806e4e"];

function colorIndex(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % palette.length;
}

function money(minor: number, locale: string, compact = false) {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "MAD", maximumFractionDigits: compact ? 1 : 2,
    notation: compact ? "compact" : "standard",
  }).format(minor / 100);
}

export function CategoryRevenueWidget({ rows, filters, locale, labels, canDrillDown }: {
  rows: Row[]; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const months = dashboardBuckets({ from: filters.from, to: filters.to }, "monthly").map((bucket) => bucket.slice(0, 7));
  const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()];
  const visibleCategories = categories.filter(([id]) => !hidden.includes(id));
  const monthTotals = months.map((month) => rows.filter((row) => row.month === month && !hidden.includes(row.categoryId)).reduce((sum, row) => sum + row.revenueMinor, 0));
  const max = Math.max(1, ...monthTotals);
  const toggle = (categoryId: string) => setHidden((current) => current.includes(categoryId)
    ? current.filter((id) => id !== categoryId)
    : [...current, categoryId]);

  return <section className="analytics-panel" aria-labelledby="category-revenue-title">
    <div className="analytics-panel-heading"><div><h2 id="category-revenue-title">{labels.categoryRevenue}</h2><p>{labels.categoryRevenueDescription}</p></div></div>
    <div className="stacked-chart" aria-label={labels.categoryRevenue}>
      {months.map((month, monthIndex) => {
        const total = monthTotals[monthIndex] ?? 0;
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
        const from = monthStart < filters.from ? filters.from : monthStart;
        const to = monthEnd > filters.to ? filters.to : monthEnd;
        const bar = <><div className="stacked-bar" style={{ height: `${Math.max(3, total / max * 100)}%` }}>
          {visibleCategories.map(([categoryId, categoryName]) => {
            const value = rows.find((row) => row.month === month && row.categoryId === categoryId)?.revenueMinor ?? 0;
            if (!value || !total) return null;
            const segment = <span className="stacked-segment" style={{ height: `${value / total * 100}%`, background: palette[colorIndex(categoryId)] }} title={`${categoryName}: ${money(value, locale)}`}><i>{money(value, locale)}</i></span>;
            return canDrillDown
              ? <Link key={categoryId} className="stacked-segment-link" href={dashboardInvoiceHref(locale, filters, { from, to }, { categoryId })} aria-label={`${categoryName}, ${month}: ${money(value, locale)}`}>{segment}</Link>
              : <span key={categoryId} className="stacked-segment-link">{segment}</span>;
          })}
        </div><span className="stacked-month-label">{month}</span></>;
        return <div className="stacked-month" key={month} aria-label={`${month}: ${money(total, locale)}`}>{bar}</div>;
      })}
      {!rows.length && <p className="analytics-empty">{labels.noChartData}</p>}
    </div>
    <div className="category-legend">{categories.map(([id, name]) => <button type="button" key={id} aria-pressed={!hidden.includes(id)} onClick={() => toggle(id)}><i style={{ background: palette[colorIndex(id)] }} />{name}</button>)}</div>
    <details className="chart-data-table"><summary>{labels.viewData}</summary><div className="table-scroll"><table><thead><tr><th>{labels.period}</th>{visibleCategories.map(([id, name]) => <th key={id}>{name}</th>)}</tr></thead><tbody>{months.map((month) => <tr key={month}><td>{month}</td>{visibleCategories.map(([id]) => <td key={id}>{money(rows.find((row) => row.month === month && row.categoryId === id)?.revenueMinor ?? 0, locale)}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
