import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, ReceiptText, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseInvoiceFilters, type InvoiceFilters } from "@/lib/invoices/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { listInvoices } from "@/server/queries/invoices";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

const dashboardFilterKeys = ["warehouseId", "categoryId", "customerId", "productId", "segment"] as const;

function buildInvoiceQuery(filters: InvoiceFilters) {
  const query = new URLSearchParams();
  for (const key of ["q", "status", "from", "to", "asOf", "warehouseId", "categoryId", "customerId", "productId", "segment", "aging", "sort", "direction"] as const) {
    const value = filters[key];
    if (typeof value === "string" && value && !(key === "status" && value === "all") && !(key === "sort" && value === "issuedAt") && !(key === "direction" && value === "desc")) query.set(key, value);
  }
  if (filters.page > 1) query.set("page", String(filters.page));
  return query.toString();
}

function invoiceHref(locale: string, invoiceId: string, filters: InvoiceFilters) {
  const query = buildInvoiceQuery(filters);
  return `/${locale}/sales/invoices/${invoiceId}${query ? `?${query}` : ""}`;
}

export default async function InvoicesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "invoices:read")) notFound();
  const role = session.user.appRole;
  const t = await getTranslations("invoices");
  const rawParams = await searchParams;
  const parsed = parseInvoiceFilters(rawParams);
  const result = parsed.success
    ? await listInvoices({ organizationId: session.user.organizationId, role, filters: parsed.data })
    : null;
  const filters = parsed.success ? parsed.data : null;
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Casablanca" }).format(value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const scopedByDashboard = Boolean(filters && (dashboardFilterKeys.some((key) => filters[key]) || filters.aging));
  const hasLineFilter = Boolean(filters?.productId || filters?.categoryId);
  const defaultAsOf = result?.asOf ?? filters?.asOf ?? filters?.to ?? "";
  const listHref = (page: number) => {
    if (!filters) return `/${locale}/sales/invoices`;
    const query = new URLSearchParams(buildInvoiceQuery({ ...filters, page }));
    const serialized = query.toString();
    return `/${locale}/sales/invoices${serialized ? `?${serialized}` : ""}`;
  };

  return <div className="invoices-page">
    <section className="welcome-row">
      <div><p className="page-kicker">ATLAS / SALES</p><h1>{t("title")}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <span className="orders-record-count"><ReceiptText size={15} /> {result ? `${new Intl.NumberFormat(locale).format(result.total)} ${t("invoiceCount")}` : t("ledger")}</span>
    </section>

    {!parsed.success && <section className="customer-filter-error" role="alert"><strong>{t("invalidFilters")}</strong><span>{t("invalidFiltersHelp")}</span><Link href={`/${locale}/sales/invoices`}>{t("clearFilters")}</Link></section>}

    {result && filters && <>
      {scopedByDashboard && <p className="invoice-scope-note"><span aria-hidden="true">↳</span> {t("filteredByDashboard")} <Link href={`/${locale}/sales/invoices`}>{t("clearDashboardFilters")}</Link></p>}
      {hasLineFilter && result.matchingLineRevenueMinor !== null && <p className="invoice-matching-total"><strong>{t("matchingLineRevenue")}: {money(result.matchingLineRevenueMinor)}</strong><span>{t("matchingLineRevenueNote", { count: result.total })}</span></p>}
      <section className="invoice-list-section" aria-labelledby="invoice-list-title">
        <div className="section-heading"><div><div className="section-title-line"><h2 id="invoice-list-title">{t("ledger")}</h2><span className="table-count">{String(result.total).padStart(2, "0")}</span></div><p>{t("ledgerDescription")}</p></div></div>
        <div className="table-frame">
          <form className="invoice-filters" action={`/${locale}/sales/invoices`} method="get">
            <label className="customer-search invoice-search"><Search size={15} /><span className="sr-only">{t("searchLabel")}</span><input type="search" name="q" maxLength={80} defaultValue={filters.q} placeholder={t("searchPlaceholder")} /></label>
            <label><span>{t("status")}</span><select name="status" defaultValue={filters.status}>
              <option value="all">{t("allStatuses")}</option><option value="unpaid">{t("statusLabels.unpaid")}</option><option value="partial">{t("statusLabels.partial")}</option><option value="paid">{t("statusLabels.paid")}</option><option value="overdue">{t("statusLabels.overdue")}</option>
            </select></label>
            <label><span>{t("from")}</span><input type="date" name="from" defaultValue={filters.from} /></label>
            <label><span>{t("to")}</span><input type="date" name="to" defaultValue={filters.to} /></label>
            <label><span>{t("asOf")}</span><input type="date" name="asOf" defaultValue={defaultAsOf} /></label>
            <label><span>{t("sort")}</span><select name="sort" defaultValue={filters.sort}>
              <option value="issuedAt">{t("sorts.issuedAt")}</option><option value="dueDate">{t("sorts.dueDate")}</option><option value="invoiceNumber">{t("sorts.invoiceNumber")}</option><option value="customer">{t("sorts.customer")}</option><option value="total">{t("sorts.total")}</option>
            </select></label>
            <label><span>{t("direction")}</span><select name="direction" defaultValue={filters.direction}><option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option></select></label>
            {dashboardFilterKeys.map((key) => filters[key] && <input key={key} type="hidden" name={key} value={filters[key]} />)}
            {filters.aging && <input type="hidden" name="aging" value={filters.aging} />}
            <button type="submit" className="customer-filter-button">{t("applyFilters")} <ArrowRight size={14} /></button>
          </form>
          <p className="invoice-as-of-note">{t("asOfNote", { date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Casablanca" }).format(new Date(`${result.asOf}T12:00:00Z`)) })}</p>
          <div className="table-scroll"><table className="product-table invoice-table">
            <thead><tr><th>{t("invoice")}</th><th>{t("customer")}</th><th>{t("order")}</th><th>{t("issued")}</th><th>{t("due")}</th><th>{t("status")}</th>{hasLineFilter && <th className="align-right">{t("matchingLineRevenue")}</th>}<th className="align-right">{t("total")}</th><th className="align-right">{t("paid")}</th><th className="align-right">{t("outstanding")}</th><th scope="col" aria-label={t("openInvoice")} /></tr></thead>
            <tbody>{result.rows.map((invoice) => {
              const visibleStatus = invoice.overdue ? "overdue" : invoice.status;
              return <tr key={invoice.id}>
                <td><Link className="order-number-link" href={invoiceHref(locale, invoice.id, filters)}>{invoice.number}</Link></td>
                <td>{can(role, "customers:read") ? <Link className="invoice-customer-link" href={`/${locale}/sales/customers/${invoice.customerId}`}>{invoice.customerName}</Link> : invoice.customerName}</td>
                <td><Link className="order-number-link" href={`/${locale}/sales/orders/${invoice.orderId}`}>{invoice.orderNumber}</Link></td>
                <td>{date(invoice.issuedAt)}</td><td>{date(invoice.dueDate)}</td>
                <td><span className={`invoice-status invoice-status-${visibleStatus}`}>{t(`statusLabels.${visibleStatus}`)}</span></td>
                {hasLineFilter && <td className="align-right money-cell">{money(invoice.matchingLineRevenueMinor ?? 0)}</td>}
                <td className="align-right money-cell">{money(invoice.totalMinor)}</td><td className="align-right money-cell">{money(invoice.paidMinor)}</td><td className="align-right money-cell">{money(invoice.outstandingMinor)}</td>
                <td><Link className="row-open-link" href={invoiceHref(locale, invoice.id, filters)} aria-label={`${t("openInvoice")} ${invoice.number}`}><ArrowUpRight size={16} /></Link></td>
              </tr>;
            })}</tbody>
          </table>{result.rows.length === 0 && <div className="table-empty">{t("empty")}</div>}</div>
          <nav className="customer-pagination" aria-label={t("pagination")}><span>{t("pageOf", { page: result.page, pages: Math.max(result.totalPages, 1) })}</span><div>
            {result.page > 1 ? <Link href={listHref(result.page - 1)} aria-label={t("previousPage")}><ArrowLeft size={15} /> {t("previous")}</Link> : <span aria-disabled="true"><ArrowLeft size={15} /> {t("previous")}</span>}
            {result.page < result.totalPages ? <Link href={listHref(result.page + 1)} aria-label={t("nextPage")}>{t("next")} <ArrowRight size={15} /></Link> : <span aria-disabled="true">{t("next")} <ArrowRight size={15} /></span>}
          </div></nav>
        </div>
      </section>
      <footer className="page-note"><span>ATLAS / INVOICE LEDGER</span><span>{t("footerNote")}</span></footer>
    </>}
  </div>;
}
