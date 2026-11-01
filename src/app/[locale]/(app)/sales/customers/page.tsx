import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, Search, UsersRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseCustomerFilters } from "@/lib/customers/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { listCustomers } from "@/server/queries/customers";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

export default async function CustomersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "customers:read")) notFound();
  const t = await getTranslations("customers");
  const parsed = parseCustomerFilters(await searchParams);
  const result = parsed.success
    ? await listCustomers({ organizationId: session.user.organizationId, role: session.user.appRole, filters: parsed.data })
    : null;
  const filters = parsed.success ? parsed.data : { q: "", segment: "all" as const, page: 1 };
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const date = (value: Date | null) => value
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Casablanca" }).format(value)
    : t("noOrders");
  const hrefForPage = (page: number) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.segment !== "all") query.set("segment", filters.segment);
    if (page > 1) query.set("page", String(page));
    const serialized = query.toString();
    return `/${locale}/sales/customers${serialized ? `?${serialized}` : ""}`;
  };
  const customerHref = (customerId: string) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.segment !== "all") query.set("segment", filters.segment);
    if (filters.page > 1) query.set("page", String(filters.page));
    const serialized = query.toString();
    return `/${locale}/sales/customers/${customerId}${serialized ? `?${serialized}` : ""}`;
  };

  return <div className="customer-directory">
    <section className="welcome-row">
      <div><p className="page-kicker">ATLAS / SALES</p><h1>{t("title")}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <span className="orders-record-count"><UsersRound size={15} /> {result ? `${number(result.total)} ${t("accounts")}` : t("directory")}</span>
    </section>

    {!parsed.success && <section className="customer-filter-error" role="alert"><strong>{t("invalidFilters")}</strong><span>{t("invalidFiltersHelp")}</span><Link href={`/${locale}/sales/customers`}>{t("clearFilters")}</Link></section>}

    {result && <>
      <section className="customer-ledger-intro" aria-label={t("ledgerSummary")}>
        <div className="customer-ledger-mark"><UsersRound size={20} /></div>
        <div><strong>{t("ledgerTitle")}</strong><p>{t("ledgerDescription")}</p></div>
        <span className="customer-ledger-total"><b>{number(result.total)}</b><small>{t("matchingAccounts")}</small></span>
      </section>

      <section className="customer-list-section" aria-labelledby="customer-list-title">
        <div className="section-heading">
          <div><div className="section-title-line"><h2 id="customer-list-title">{t("directory")}</h2><span className="table-count">{String(result.total).padStart(2, "0")}</span></div><p>{t("listDescription")}</p></div>
        </div>
        <div className="table-frame">
          <form className="customer-filters" action={`/${locale}/sales/customers`} method="get">
            <label className="customer-search"><Search size={15} /><span className="sr-only">{t("searchLabel")}</span><input type="search" name="q" maxLength={80} defaultValue={filters.q} placeholder={t("searchPlaceholder")} /></label>
            <label className="customer-segment-filter"><span>{t("segment")}</span><select name="segment" defaultValue={filters.segment}>
              <option value="all">{t("allSegments")}</option>
              <option value="Retail">{t("segments.Retail")}</option>
              <option value="Hospitality">{t("segments.Hospitality")}</option>
              <option value="Wholesale">{t("segments.Wholesale")}</option>
            </select></label>
            <button type="submit" className="customer-filter-button">{t("applyFilters")} <ArrowRight size={14} /></button>
            {(filters.q || filters.segment !== "all") && <Link className="customer-clear-link" href={`/${locale}/sales/customers`}>{t("clearFilters")}</Link>}
          </form>
          <div className="table-scroll"><table className="product-table customer-table">
            <thead><tr><th>{t("customer")}</th><th>{t("segment")}</th><th>{t("city")}</th><th className="align-right">{t("terms")}</th><th className="align-right">{t("orders")}</th><th>{t("lastOrder")}</th><th scope="col" aria-label={t("openCustomer")} /></tr></thead>
            <tbody>{result.rows.map((customer) => <tr key={customer.id}>
              <td><Link className="customer-name-link" href={customerHref(customer.id)}><span className="customer-avatar" aria-hidden="true">{customer.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{customer.name}</strong><small>{t("since", { date: date(customer.createdAt) })}</small></span></Link></td>
              <td><span className={`customer-segment segment-${customer.segment.toLowerCase()}`}>{t(`segments.${customer.segment}`)}</span></td>
              <td>{customer.city}</td><td className="align-right">{number(customer.paymentTermsDays)} {t("days")}</td><td className="align-right font-data">{number(customer.orderCount)}</td><td>{customer.lastOrderAt ? date(customer.lastOrderAt) : t("noLastOrder")}</td>
              <td><Link className="row-open-link" href={customerHref(customer.id)} aria-label={`${t("openCustomer")} ${customer.name}`}><ArrowUpRight size={16} /></Link></td>
            </tr>)}</tbody>
          </table>
          {result.rows.length === 0 && <div className="table-empty">{t("empty")}</div>}
          </div>
          <nav className="customer-pagination" aria-label={t("pagination")}>
            <span>{t("pageOf", { page: result.page, pages: Math.max(result.totalPages, 1) })}</span>
            <div>
              {result.page > 1 ? <Link href={hrefForPage(result.page - 1)} aria-label={t("previousPage")}><ArrowLeft size={15} /> {t("previous")}</Link> : <span aria-disabled="true"><ArrowLeft size={15} /> {t("previous")}</span>}
              {result.page < result.totalPages ? <Link href={hrefForPage(result.page + 1)} aria-label={t("nextPage")}>{t("next")} <ArrowRight size={15} /></Link> : <span aria-disabled="true">{t("next")} <ArrowRight size={15} /></span>}
            </div>
          </nav>
        </div>
      </section>
      <footer className="page-note"><span>ATLAS / CUSTOMER LEDGER</span><span>{t("footerNote")}</span></footer>
    </>}
  </div>;
}
