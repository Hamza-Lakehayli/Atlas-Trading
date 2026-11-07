import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, FileText, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseQuoteFilters } from "@/lib/quotes/filters";
import { businessDate } from "@/lib/dates/business-date";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getQuoteCreationOptions, listQuotes } from "@/server/queries/quotes";
import { createQuoteAction } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

export default async function QuotesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "quotes:read")) notFound();
  const t = await getTranslations("quotes");
  const rawSearchParams = await searchParams;
  const parsed = parseQuoteFilters(rawSearchParams);
  const result = parsed.success
    ? await listQuotes({ organizationId: session.user.organizationId, role: session.user.appRole, filters: parsed.data })
    : null;
  const filters = parsed.success ? parsed.data : { q: "", status: "all" as const, page: 1 };
  const options = can(session.user.appRole, "quotes:write")
    ? await getQuoteCreationOptions({ organizationId: session.user.organizationId, role: session.user.appRole })
    : null;
  const date = (value: Date | string) => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Casablanca",
  }).format(typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const today = businessDate();
  const defaultValidUntil = new Date(`${today}T12:00:00Z`);
  defaultValidUntil.setUTCDate(defaultValidUntil.getUTCDate() + 30);
  const validUntilDefault = defaultValidUntil.toISOString().slice(0, 10);
  const statusLabel = (status: string, expired = false) => t(`statusLabels.${expired ? "expired" : status}`);
  const error = rawSearchParams.error;
  const knownError = typeof error === "string" && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INVALID_TRANSITION", "INTERNAL"].includes(error)
    ? error : null;
  const hrefForPage = (page: number) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.status !== "all") query.set("status", filters.status);
    if (page > 1) query.set("page", String(page));
    const serialized = query.toString();
    return `/${locale}/sales/quotes${serialized ? `?${serialized}` : ""}`;
  };
  const quoteHref = (quoteId: string) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.status !== "all") query.set("status", filters.status);
    if (filters.page > 1) query.set("page", String(filters.page));
    const serialized = query.toString();
    return `/${locale}/sales/quotes/${quoteId}${serialized ? `?${serialized}` : ""}`;
  };

  return <div className="quotes-page">
    <section className="welcome-row">
      <div><p className="page-kicker">ATLAS / SALES</p><h1>{t("title")}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <span className="orders-record-count"><FileText size={15} /> {result ? `${new Intl.NumberFormat(locale).format(result.total)} ${t("createdCount")}` : t("quoteLedger")}</span>
    </section>

    {knownError && <p className="order-alert" role="alert">{t(`errors.${knownError}`)}</p>}
    {!parsed.success && <section className="customer-filter-error" role="alert"><strong>{t("invalidFilters")}</strong><Link href={`/${locale}/sales/quotes`}>{t("clearFilters")}</Link></section>}

    {options && <section className="order-create-panel quote-create-panel">
      <div className="order-panel-heading"><div><span className="quote-panel-mark"><FileText size={17} /></span><div><h2>{t("newQuote")}</h2><p>{t("newQuoteHelp")}</p></div></div><span className="draft-label">{t("statusLabels.draft")}</span></div>
      <form action={createQuoteAction} className="quote-create-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <label><span>{t("customer")}</span><select required name="customerId" defaultValue=""><option value="" disabled>{t("chooseCustomer")}</option>{options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label><span>{t("warehouse")}</span><select required name="warehouseId" defaultValue=""><option value="" disabled>{t("chooseWarehouse")}</option>{options.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label className="quote-product-field"><span>{t("product")}</span><select required name="productId" defaultValue=""><option value="" disabled>{t("chooseProduct")}</option>{options.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} · {money(product.unitPriceMinor)}</option>)}</select></label>
        <label className="quote-quantity-field"><span>{t("quantity")}</span><input required name="quantity" type="number" min="1" max="999" defaultValue="1" /></label>
        <label className="quote-validity-field"><span>{t("validUntil")}</span><input required name="validUntil" type="date" min={today} defaultValue={validUntilDefault} /></label>
        <button className="order-primary-button" type="submit">{t("createDraft")} <ArrowRight size={15} /></button>
      </form>
    </section>}

    {result && <>
      <section className="quote-ledger-intro" aria-label={t("ledgerSummary")}>
        <div className="quote-ledger-mark"><FileText size={19} /></div>
        <div><strong>{t("ledgerSummary")}</strong><p>{t("ledgerSummaryDescription")}</p></div>
        <span className="quote-ledger-total"><b>{new Intl.NumberFormat(locale).format(result.total)}</b><small>{t("createdCount")}</small></span>
      </section>

      <section className="quote-list-section" aria-labelledby="quote-list-title">
        <div className="section-heading"><div><div className="section-title-line"><h2 id="quote-list-title">{t("quoteLedger")}</h2><span className="table-count">{String(result.total).padStart(2, "0")}</span></div><p>{t("quoteListDescription")}</p></div></div>
        <div className="table-frame">
          <form className="customer-filters" action={`/${locale}/sales/quotes`} method="get">
            <label className="customer-search"><Search size={15} /><span className="sr-only">{t("searchLabel")}</span><input type="search" name="q" maxLength={80} defaultValue={filters.q} placeholder={t("searchPlaceholder")} /></label>
            <label className="customer-segment-filter"><span>{t("filterStatus")}</span><select name="status" defaultValue={filters.status}>
              <option value="all">{t("allStatuses")}</option>
              <option value="draft">{t("statusLabels.draft")}</option>
              <option value="sent">{t("statusLabels.sent")}</option>
              <option value="expired">{t("statusLabels.expired")}</option>
              <option value="accepted">{t("statusLabels.accepted")}</option>
              <option value="rejected">{t("statusLabels.rejected")}</option>
              <option value="converted">{t("statusLabels.converted")}</option>
            </select></label>
            <button type="submit" className="customer-filter-button">{t("applyFilters")} <ArrowRight size={14} /></button>
            {(filters.q || filters.status !== "all") && <Link className="customer-clear-link" href={`/${locale}/sales/quotes`}>{t("clearFilters")}</Link>}
          </form>
          <div className="table-scroll"><table className="product-table quotes-table">
            <thead><tr><th>{t("number")}</th><th>{t("customer")}</th><th>{t("status")}</th><th>{t("validUntil")}</th><th className="align-right">{t("items")}</th><th className="align-right">{t("total")}</th><th scope="col" aria-label={t("openQuote")} /></tr></thead>
            <tbody>{result.rows.map((quote) => <tr key={quote.id}>
              <td><Link className="order-number-link" href={quoteHref(quote.id)}>{quote.quoteNumber}</Link></td>
              <td>{quote.customerName}</td>
              <td><span className={`quote-status quote-status-${quote.expired ? "expired" : quote.status}`}>{statusLabel(quote.status, quote.expired)}</span></td>
              <td>{date(quote.validUntil)}</td><td className="align-right font-data">{quote.lineCount}</td><td className="align-right money-cell">{money(quote.totalMinor)}</td>
              <td><Link className="row-open-link" href={quoteHref(quote.id)} aria-label={`${t("openQuote")} ${quote.quoteNumber}`}><ArrowUpRight size={16} /></Link></td>
            </tr>)}</tbody>
          </table>{result.rows.length === 0 && <div className="table-empty">{t("empty")}</div>}</div>
          <nav className="customer-pagination" aria-label={t("pagination")}>
            <span>{t("pageOf", { page: result.page, pages: Math.max(result.totalPages, 1) })}</span>
            <div>
              {result.page > 1 ? <Link href={hrefForPage(result.page - 1)} aria-label={t("previousPage")}><ArrowLeft size={15} /> {t("previous")}</Link> : <span aria-disabled="true"><ArrowLeft size={15} /> {t("previous")}</span>}
              {result.page < result.totalPages ? <Link href={hrefForPage(result.page + 1)} aria-label={t("nextPage")}>{t("next")} <ArrowRight size={15} /></Link> : <span aria-disabled="true">{t("next")} <ArrowRight size={15} /></span>}
            </div>
          </nav>
        </div>
      </section>
      <footer className="page-note"><span>ATLAS / QUOTE LEDGER</span><span>{t("footerNote")}</span></footer>
    </>}
  </div>;
}
