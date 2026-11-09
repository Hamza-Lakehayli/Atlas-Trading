import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardFilters } from "@/lib/dashboard/filters";
import { dashboardInvoiceHref } from "@/lib/dashboard/drilldowns";

type Point = { bucket: string; revenueMinor: number; cogsMinor: number; invoiceCount: number };
type Trend = { current: Point[]; previous: Point[]; previousRange: { from: string; to: string } | null };
type Funnel = { stages: Array<{ key: string; count: number }> };
type Aging = { asOf: string; rows: Array<{ key: string; balanceMinor: number; invoiceCount: number }>; unsupported: { category: boolean; warehouse: boolean } };

function Drilldown({ enabled, href, className, children, label }: { enabled: boolean; href: string; className?: string; children: ReactNode; label?: string }) {
  if (!enabled) return <span className={className} aria-label={label}>{children}</span>;
  return <Link className={className} href={href} aria-label={label}>{children}</Link>;
}

function formatMoney(minor: number, locale: string, compact = false) {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "MAD", maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(minor / 100);
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function chartPath(values: number[], width: number, height: number, max: number) {
  if (!values.length) return "";
  const gap = values.length === 1 ? width / 2 : width / (values.length - 1);
  return values.map((value, index) => `${index ? "L" : "M"}${(index * gap).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`).join(" ");
}

export function RevenueTrendWidget({ data, filters, locale, labels, canDrillDown }: { data: Trend; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean }) {
  const width = 720;
  const height = 210;
  const max = Math.max(1, ...data.current.map((point) => point.revenueMinor), ...data.previous.map((point) => point.revenueMinor));
  const current = data.current.map((point) => point.revenueMinor);
  const previous = data.previous.map((point) => point.revenueMinor);
  const currentPath = chartPath(current, width, height, max);
  const previousPath = chartPath(previous, width, height, max);
  const areaPath = currentPath ? `${currentPath} L${width},${height} L0,${height} Z` : "";
  const average = data.current.length ? Math.round(current.reduce((sum, value) => sum + value, 0) / current.length) : 0;
  return <section className="analytics-panel dashboard-revenue-panel" aria-labelledby="revenue-trend-title">
    <div className="analytics-panel-heading"><div><h2 id="revenue-trend-title">{labels.revenueTrend}</h2><p>{labels.issuedInvoiceBasis}</p></div><Drilldown enabled={canDrillDown} href={dashboardInvoiceHref(locale, filters)}>{labels.openInvoices}</Drilldown></div>
    <div className="trend-chart-wrap">
      <div className="trend-chart-y-labels"><span>{formatMoney(max, locale, true)}</span><span>{formatMoney(Math.round(max / 2), locale, true)}</span><span>{formatMoney(0, locale, true)}</span></div>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={labels.revenueTrend} preserveAspectRatio="none">
        <defs><linearGradient id="revenue-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--mineral)" stopOpacity=".2" /><stop offset="1" stopColor="var(--mineral)" stopOpacity="0" /></linearGradient></defs>
        {[0, height / 2, height].map((y) => <line key={y} x1="0" x2={width} y1={y} y2={y} className="chart-gridline" />)}
        {areaPath && <path d={areaPath} fill="url(#revenue-area)" />}
        {previousPath && <path d={previousPath} className="chart-line chart-line-previous" />}
        {currentPath && <path d={currentPath} className="chart-line chart-line-current" />}
        {data.current.map((point, index) => {
          const x = data.current.length === 1 ? width / 2 : index * width / (data.current.length - 1);
          const y = height - (point.revenueMinor / max) * height;
          const bucketDate = new Date(`${point.bucket}T12:00:00.000Z`);
          let bucketEnd = point.bucket;
          if (filters.granularity === "weekly") bucketEnd = new Date(bucketDate.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
          if (filters.granularity === "monthly") bucketEnd = new Date(Date.UTC(bucketDate.getUTCFullYear(), bucketDate.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
          const from = point.bucket < filters.from ? filters.from : point.bucket;
          const to = bucketEnd > filters.to ? filters.to : bucketEnd;
          const pointMark = <circle cx={x} cy={y} r="3" className="chart-point"><title>{`${point.bucket}: ${formatMoney(point.revenueMinor, locale)}`}</title></circle>;
          return canDrillDown
            ? <a key={point.bucket} href={dashboardInvoiceHref(locale, filters, { from, to })} aria-label={`${point.bucket}: ${formatMoney(point.revenueMinor, locale)}`}>{pointMark}</a>
            : <g key={point.bucket}>{pointMark}</g>;
        })}
      </svg>
      <div className="trend-chart-x-labels"><span>{data.current[0]?.bucket ?? "—"}</span><span>{data.current[Math.floor(data.current.length / 2)]?.bucket ?? "—"}</span><span>{data.current.at(-1)?.bucket ?? "—"}</span></div>
    </div>
    <div className="chart-legend"><span><i className="legend-current" />{labels.currentPeriod}</span>{data.previousRange && <span><i className="legend-previous" />{labels.comparisonPeriod}</span>}<span className="chart-average">{labels.averagePerBucket}: {formatMoney(average, locale)}</span></div>
    <details className="chart-data-table"><summary>{labels.viewData}</summary><div className="table-scroll"><table><thead><tr><th>{labels.period}</th><th>{labels.revenue}</th>{data.previousRange && <th>{labels.comparisonPeriod}</th>}<th>{labels.cogs}</th><th>{labels.invoices}</th></tr></thead><tbody>{data.current.map((point, index) => <tr key={point.bucket}><td>{point.bucket}</td><td>{formatMoney(point.revenueMinor, locale)}</td>{data.previousRange && <td>{formatMoney(data.previous[index]?.revenueMinor ?? 0, locale)}</td>}<td>{formatMoney(point.cogsMinor, locale)}</td><td>{point.invoiceCount}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function QuoteFunnelWidget({ data, filters, locale, labels, canDrillDown }: { data: Funnel; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean }) {
  const quoteQuery = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.warehouseId !== "all") quoteQuery.set("warehouseId", filters.warehouseId);
  if (filters.categoryId !== "all") quoteQuery.set("categoryId", filters.categoryId);
  if (filters.segment !== "all") quoteQuery.set("segment", filters.segment);
  const funnelLink = `/${locale}/sales/quotes?${quoteQuery}`;
  const stages = data.stages;
  return <section className="analytics-panel" aria-labelledby="quote-funnel-title">
    <div className="analytics-panel-heading"><div><h2 id="quote-funnel-title">{labels.quoteFunnel}</h2><p>{labels.quoteFunnelDescription}</p></div><Drilldown enabled={canDrillDown} href={funnelLink}>{labels.openQuotes}</Drilldown></div>
    <div className="funnel-stages">{stages.map((stage, index) => {
      const previous = stages[index - 1]?.count;
      const conversion = previous ? stage.count / previous * 100 : null;
      const width = stages[0]?.count ? Math.max(8, stage.count / stages[0].count * 100) : 8;
      const stageQuery = new URLSearchParams(quoteQuery);
      stageQuery.set("funnelStage", stage.key);
      return <Drilldown className="funnel-stage" href={`/${locale}/sales/quotes?${stageQuery}`} enabled={canDrillDown} key={stage.key}>
        <span>{labels[`funnel_${stage.key}`] ?? stage.key}</span><div className="funnel-bar-track"><i style={{ width: `${width}%` }} /></div><strong>{formatNumber(stage.count, locale)}</strong>{index > 0 && <small>{conversion === null ? "—" : `${formatNumber(conversion, locale)}%`}</small>}
      </Drilldown>;
    })}</div>
    <details className="chart-data-table"><summary>{labels.viewData}</summary><table><thead><tr><th>{labels.stage}</th><th>{labels.count}</th></tr></thead><tbody>{stages.map((stage) => <tr key={stage.key}><td>{labels[`funnel_${stage.key}`] ?? stage.key}</td><td>{stage.count}</td></tr>)}</tbody></table></details>
  </section>;
}

export function ReceivablesAgingWidget({ data, filters, locale, labels, canDrillDown }: { data: Aging; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean }) {
  const max = Math.max(1, ...data.rows.map((row) => row.balanceMinor));
  const unsupported = [data.unsupported.warehouse && labels.warehouseNotApplied, data.unsupported.category && labels.categoryNotApplied].filter(Boolean).join(" ");
  const href = (bucket: string) => `/${locale}/sales/invoices?asOf=${data.asOf}&aging=${bucket}${filters.segment !== "all" ? `&segment=${filters.segment}` : ""}`;
  return <section className="analytics-panel" aria-labelledby="ar-aging-title">
    <div className="analytics-panel-heading"><div><h2 id="ar-aging-title">{labels.receivablesAging}</h2><p>{labels.receivablesAgingDescription}</p></div><Drilldown enabled={canDrillDown} href={`/${locale}/sales/invoices?asOf=${data.asOf}${filters.segment !== "all" ? `&segment=${filters.segment}` : ""}`}>{labels.openReceivables}</Drilldown></div>
    {unsupported && <p className="analytics-filter-note">{unsupported}</p>}
    <div className="aging-bars">{data.rows.map((row) => <Drilldown href={href(row.key)} enabled={canDrillDown} className="aging-row" key={row.key}>
      <span>{labels[`aging_${row.key}`] ?? row.key}</span><span className="aging-track"><i style={{ width: `${row.balanceMinor / max * 100}%` }} /></span><strong>{formatMoney(row.balanceMinor, locale, true)}</strong><small>{row.invoiceCount} {labels.invoices.toLowerCase()}</small>
    </Drilldown>)}</div>
    <details className="chart-data-table"><summary>{labels.viewData}</summary><table><thead><tr><th>{labels.agingBucket}</th><th>{labels.outstanding}</th><th>{labels.invoices}</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.key}><td>{labels[`aging_${row.key}`] ?? row.key}</td><td>{formatMoney(row.balanceMinor, locale)}</td><td>{row.invoiceCount}</td></tr>)}</tbody></table></details>
  </section>;
}
