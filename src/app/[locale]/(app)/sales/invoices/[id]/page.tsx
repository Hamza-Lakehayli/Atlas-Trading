import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CircleDollarSign, ReceiptText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseInvoiceFilters } from "@/lib/invoices/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getInvoiceDetail } from "@/server/queries/invoices";
import { z } from "zod";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InvoiceDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "invoices:read") || !z.uuid().safeParse(id).success) notFound();
  const t = await getTranslations("invoices");
  const rawParams = await searchParams;
  const parsed = parseInvoiceFilters(rawParams);
  const detail = await getInvoiceDetail({
    organizationId: session.user.organizationId,
    role: session.user.appRole,
    invoiceId: id,
    asOf: parsed.success ? parsed.data.asOf ?? parsed.data.to : undefined,
  });
  if (!detail) notFound();
  const filters = parsed.success ? parsed.data : null;
  const backQuery = new URLSearchParams();
  if (filters) {
    for (const key of ["q", "status", "from", "to", "asOf", "warehouseId", "categoryId", "customerId", "productId", "segment", "aging", "sort", "direction"] as const) {
      const value = filters[key];
      if (typeof value === "string" && value && !(key === "status" && value === "all") && !(key === "sort" && value === "issuedAt") && !(key === "direction" && value === "desc")) backQuery.set(key, value);
    }
    if (filters.page > 1) backQuery.set("page", String(filters.page));
  }
  const backQueryString = backQuery.toString();
  const backHref = `/${locale}/sales/invoices${backQueryString ? `?${backQueryString}` : ""}`;
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Casablanca" }).format(value);
  const dateTime = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca" }).format(value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const visibleStatus = detail.overdue ? "overdue" : detail.status;
  const grossProfitMinor = detail.invoice.totalMinor - detail.invoice.cogsMinor;
  const errorFilters = !parsed.success;

  return <div className="invoice-detail-page">
    <Link className="back-link" href={backHref}><ArrowLeft size={15} /> {t("backToInvoices")}</Link>
    {errorFilters && <section className="customer-filter-error" role="alert"><strong>{t("invalidFilters")}</strong><span>{t("invalidFiltersHelp")}</span><Link href={`/${locale}/sales/invoices`}>{t("clearFilters")}</Link></section>}

    <section className="invoice-detail-heading">
      <div className="invoice-heading-symbol"><ReceiptText size={21} /></div>
      <div className="invoice-heading-copy"><p className="page-kicker">ATLAS / SALES / {t("invoice")}</p><h1>{detail.invoice.number}</h1><p className="page-subtitle">{detail.invoice.customerName} <span aria-hidden="true">·</span> {detail.invoice.orderNumber}</p></div>
      <span className={`invoice-status invoice-status-${visibleStatus}`}>{t(`statusLabels.${visibleStatus}`)}</span>
    </section>

    <section className={`invoice-balance-strip${detail.overdue ? " invoice-balance-overdue" : ""}`} aria-label={t("outstanding")}>
      <div><span>{t("total")}</span><strong>{money(detail.invoice.totalMinor)}</strong></div>
      <div><span>{t("paid")}</span><strong>{money(detail.paidMinor)}</strong></div>
      <div><span>{t("outstanding")}</span><strong>{money(detail.outstandingMinor)}</strong></div>
      <p>{t("asOfNote", { date: date(new Date(`${detail.asOf}T12:00:00Z`)) })}</p>
    </section>

    <div className="invoice-detail-grid">
      <div className="invoice-main-column">
        <section className="order-content-panel invoice-lines-panel">
          <div className="order-content-title"><div><h2>{t("lines")}</h2><p>{detail.lines.length} {t("items")}</p></div><strong>{money(detail.invoice.totalMinor)}</strong></div>
          <div className="table-scroll"><table className="product-table invoice-lines-table">
            <thead><tr><th>{t("product")}</th><th>{t("category")}</th><th className="align-right">{t("quantity")}</th><th className="align-right">{t("unitPrice")}</th><th className="align-right">{t("lineTotal")}</th></tr></thead>
            <tbody>{detail.lines.map((line) => <tr key={line.id}>
              <td><div className="order-product-name"><span className="sku-code">{line.sku}</span><strong>{line.productName}</strong></div></td>
              <td>{line.categoryName}</td><td className="align-right font-data">{line.quantity}</td><td className="align-right money-cell">{money(line.unitPriceMinor)}</td><td className="align-right money-cell">{money(line.unitPriceMinor * line.quantity)}</td>
            </tr>)}</tbody>
          </table>{detail.lines.length === 0 && <div className="table-empty">{t("noLines")}</div>}</div>
        </section>

        <section className="order-content-panel invoice-payments-panel">
          <div className="order-content-title"><div><h2><CircleDollarSign size={17} /> {t("paymentHistory")}</h2><p>{t("paymentHistoryDescription", { date: date(new Date(`${detail.asOf}T12:00:00Z`)) })}</p></div><span className="table-count">{String(detail.paymentCount).padStart(2, "0")}</span></div>
          <div className="table-scroll"><table className="product-table invoice-payment-table">
            <thead><tr><th>{t("paymentDate")}</th><th>{t("method")}</th><th className="align-right">{t("amount")}</th></tr></thead>
            <tbody>{detail.payments.map((payment) => <tr key={payment.id}>
              <td>{dateTime(payment.paidAt)}</td><td>{t(`methods.${payment.method}`)}</td><td className="align-right money-cell">{money(payment.amountMinor)}</td>
            </tr>)}</tbody>
          </table>{detail.payments.length === 0 && <div className="table-empty">{t("noPayments")}</div>}</div>
          {detail.paymentCount > detail.payments.length && <p className="invoice-history-note">{t("recentPaymentsOnly", { count: detail.payments.length, total: detail.paymentCount })}</p>}
        </section>
      </div>

      <aside className="invoice-facts-column">
        <section className="order-content-panel invoice-facts-panel">
          <div className="order-content-title"><div><h2>{t("customerAndOrder")}</h2></div></div>
          <div className="invoice-fact"><span>{t("customer")}</span>{can(session.user.appRole, "customers:read") ? <Link href={`/${locale}/sales/customers/${detail.invoice.customerId}`}>{detail.invoice.customerName}</Link> : <strong>{detail.invoice.customerName}</strong>}</div>
          <div className="invoice-fact"><span>{t("order")}</span><Link className="invoice-order-link" href={`/${locale}/sales/orders/${detail.invoice.orderId}`}>{detail.invoice.orderNumber} <ArrowUpRight size={13} /></Link></div>
          <div className="invoice-fact"><span>{t("warehouse")}</span><strong>{detail.invoice.warehouseName}</strong></div>
          <div className="invoice-fact"><span>{t("issued")}</span><strong>{date(detail.invoice.issuedAt)}</strong></div>
          <div className="invoice-fact"><span>{t("due")}</span><strong>{date(detail.invoice.dueDate)}</strong></div>
        </section>

        <section className="order-content-panel invoice-profit-panel">
          <div><span>{t("cogs")}</span><strong>{money(detail.invoice.cogsMinor)}</strong></div>
          <div><span>{t("grossProfit")}</span><strong>{money(grossProfitMinor)}</strong></div>
          <div><span>{t("asOf")}</span><strong>{date(new Date(`${detail.asOf}T12:00:00Z`))}</strong></div>
          <p>{t("paymentNote")}</p>
        </section>
      </aside>
    </div>
    <footer className="page-note"><span>ATLAS / INVOICE RECORD</span><span>{t("footerNote")}</span></footer>
  </div>;
}
