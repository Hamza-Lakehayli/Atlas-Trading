import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleDollarSign, FileText, PackageCheck, Send, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseQuoteFilters } from "@/lib/quotes/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getQuoteCreationOptions, getQuoteDetail } from "@/server/queries/quotes";
import { z } from "zod";
import { acceptQuoteAction, convertQuoteAction, rejectQuoteAction, sendQuoteAction, updateQuoteAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "quotes:read") || !z.uuid().safeParse(id).success) notFound();
  const detail = await getQuoteDetail({ organizationId: session.user.organizationId, role: session.user.appRole, quoteId: id });
  if (!detail) notFound();
  const t = await getTranslations("quotes");
  const paramsFromList = await searchParams;
  const parsedListFilters = parseQuoteFilters({
    q: paramsFromList.q,
    status: paramsFromList.status,
    page: paramsFromList.page,
  });
  const backQuery = new URLSearchParams();
  if (parsedListFilters.success) {
    if (parsedListFilters.data.q) backQuery.set("q", parsedListFilters.data.q);
    if (parsedListFilters.data.status !== "all") backQuery.set("status", parsedListFilters.data.status);
    if (parsedListFilters.data.page > 1) backQuery.set("page", String(parsedListFilters.data.page));
  }
  const backQueryString = backQuery.toString();
  const backHref = `/${locale}/sales/quotes${backQueryString ? `?${backQueryString}` : ""}`;
  const date = (value: Date | string) => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Casablanca",
  }).format(typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const expired = detail.expired;
  const visibleStatus = detail.expired ? "expired" : detail.quote.status;
  const error = paramsFromList.error;
  const knownError = typeof error === "string" && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INVALID_TRANSITION", "INTERNAL"].includes(error)
    ? error : null;
  const statusLabel = (status: string) => t(`statusLabels.${status}`);
  const editOptions = detail.quote.status === "draft" && can(session.user.appRole, "quotes:write")
    ? await getQuoteCreationOptions({ organizationId: session.user.organizationId, role: session.user.appRole })
    : null;
  const expiredText = detail.expired;
  const productDefault = detail.lines[0]?.productId ?? "";
  const canWrite = can(session.user.appRole, "quotes:write");
  const canConvert = canWrite && can(session.user.appRole, "orders:write");

  return <div className="quote-detail-page">
    <Link className="back-link" href={backHref}><ArrowLeft size={15} /> {t("backToQuotes")}</Link>
    {knownError && <p className="order-alert" role="alert">{t(`errors.${knownError}`)}</p>}

    <section className="quote-detail-heading">
      <div className="quote-heading-symbol"><FileText size={22} /></div>
      <div className="quote-heading-copy"><p className="page-kicker">ATLAS / SALES / {t("record")}</p><h1>{detail.quote.quoteNumber}</h1><p className="page-subtitle">{detail.quote.customerName} <span aria-hidden="true">·</span> {detail.quote.warehouseName}</p></div>
      <span className={`quote-status quote-status-${visibleStatus}`}>{statusLabel(visibleStatus)}</span>
    </section>

    <section className={`quote-validity-strip${expiredText ? " quote-validity-expired" : ""}`} aria-label={t("validity")}>
      <span className="quote-validity-icon">{expiredText ? <X size={17} /> : <Check size={17} />}</span>
      <div><strong>{expiredText ? t("statusLabels.expired") : t("validThrough", { date: date(detail.quote.validUntil) })}</strong><p>{expiredText ? t("expiredOn", { date: date(detail.quote.validUntil) }) : t("validityHelp")}</p></div>
      <span className="quote-validity-caption">{t("validity")}</span>
    </section>

    <div className="quote-detail-grid">
      <div className="quote-main-column">
        {editOptions && <section className="order-content-panel quote-edit-panel">
          <div className="order-content-title"><div><h2>{t("editDraft")}</h2><p>{t("editDraftHelp")}</p></div></div>
          <form action={updateQuoteAction} className="quote-edit-form">
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="quoteId" value={detail.quote.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label><span>{t("customer")}</span><select name="customerId" required defaultValue={detail.quote.customerId}>{editOptions.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label><span>{t("warehouse")}</span><select name="warehouseId" required defaultValue={detail.quote.warehouseId}>{editOptions.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
            <label className="quote-product-field"><span>{t("product")}</span><select name="productId" required defaultValue={productDefault}><option value="" disabled>{t("chooseProduct")}</option>{editOptions.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
            <label><span>{t("quantity")}</span><input name="quantity" type="number" min="1" max="999" defaultValue={detail.lines[0]?.quantity ?? 1} required /></label>
            <label><span>{t("validUntil")}</span><input name="validUntil" type="date" min={detail.quote.validUntil} defaultValue={detail.quote.validUntil} required /></label>
            <button className="order-primary-button" type="submit">{t("saveDraft")}</button>
          </form>
          <p className="quote-form-note">{t("validForNewQuote")}</p>
        </section>}

        <section className="order-content-panel quote-lines-panel">
          <div className="order-content-title"><div><h2>{t("lines")}</h2><p>{t("totalLines", { count: detail.lines.length })}</p></div><strong>{money(detail.totalMinor)}</strong></div>
          <div className="table-scroll"><table className="product-table quote-lines-table">
            <thead><tr><th>{t("product")}</th><th className="align-right">{t("quantity")}</th><th className="align-right">{t("unitPrice")}</th><th className="align-right">{t("lineTotal")}</th></tr></thead>
            <tbody>{detail.lines.map((line) => <tr key={line.id}>
              <td><div className="order-product-name"><span className="sku-code">{line.sku}</span><strong>{line.productName}</strong></div></td>
              <td className="align-right font-data">{line.quantity}</td><td className="align-right money-cell">{money(line.unitPriceMinor)}</td><td className="align-right money-cell">{money(line.unitPriceMinor * line.quantity)}</td>
            </tr>)}</tbody>
          </table>{detail.lines.length === 0 && <div className="table-empty">{t("noLines")}</div>}</div>
          <div className="quote-total-row"><span>{t("subtotal")}</span><strong>{money(detail.totalMinor)}</strong></div>
        </section>

        {detail.order && <section className="order-content-panel quote-converted-panel">
          <div><h2><PackageCheck size={17} /> {t("convertedOrder")}</h2><p>{statusLabel("converted")}</p></div>
          <Link className="order-number-link" href={`/${locale}/sales/orders/${detail.order.id}`}>{detail.order.orderNumber} <ArrowRight size={14} /></Link>
        </section>}

        <section className="order-content-panel quote-timeline-panel">
          <div className="order-content-title"><div><h2>{t("timeline")}</h2><p>{t("timelineDescription")}</p></div></div>
          <ol className="order-timeline">
            <li className="timeline-complete"><span><FileText size={13} /></span><div><b>{statusLabel("draft")}</b><small>{date(detail.quote.createdAt)}</small></div></li>
            {detail.quote.sentAt && <li className="timeline-complete"><span><Send size={13} /></span><div><b>{statusLabel("sent")}</b><small>{date(detail.quote.sentAt)}</small></div></li>}
            {detail.quote.acceptedAt && <li className="timeline-complete"><span><Check size={13} /></span><div><b>{statusLabel("accepted")}</b><small>{date(detail.quote.acceptedAt)}</small></div></li>}
            {detail.quote.rejectedAt && <li className="timeline-cancelled"><span><X size={13} /></span><div><b>{statusLabel("rejected")}</b><small>{date(detail.quote.rejectedAt)}</small></div></li>}
            {detail.quote.convertedAt && <li className="timeline-complete"><span><CircleDollarSign size={13} /></span><div><b>{statusLabel("converted")}</b><small>{date(detail.quote.convertedAt)}</small></div></li>}
          </ol>
        </section>
      </div>

      <aside className="quote-actions-column">
        <section className="order-content-panel quote-action-panel">
          <div className="order-content-title"><div><h2>{t("customerDetails")}</h2><p>{detail.quote.customerName}</p></div></div>
          <div className="quote-facts"><div><span>{t("warehouse")}</span><strong>{detail.quote.warehouseName}</strong></div><div><span>{t("validUntil")}</span><strong>{date(detail.quote.validUntil)}</strong></div><div><span>{t("items")}</span><strong>{detail.lines.length}</strong></div></div>
          {canWrite && detail.quote.status === "draft" && !detail.expired && <ActionForm action={sendQuoteAction} locale={locale} quoteId={detail.quote.id} idempotencyKey={randomUUID()} label={t("issue")} help={t("issueHelp")} />}
          {canWrite && detail.quote.status === "sent" && !detail.expired && <>
            <ActionForm action={acceptQuoteAction} locale={locale} quoteId={detail.quote.id} idempotencyKey={randomUUID()} label={t("accept")} help={t("acceptHelp")} />
            <ActionForm action={rejectQuoteAction} locale={locale} quoteId={detail.quote.id} idempotencyKey={randomUUID()} label={t("reject")} secondary />
          </>}
          {canConvert && detail.quote.status === "accepted" && !expired && <ActionForm action={convertQuoteAction} locale={locale} quoteId={detail.quote.id} idempotencyKey={randomUUID()} label={t("convert")} help={t("convertHelp")} />}
          {!canWrite && <p className="order-readonly-note">{t("noActions")}</p>}
          {detail.quote.status === "converted" && detail.order && <Link className="order-primary-button quote-open-order" href={`/${locale}/sales/orders/${detail.order.id}`}>{t("convertedOrder")} <ArrowRight size={15} /></Link>}
        </section>
      </aside>
    </div>
    <footer className="page-note"><span>ATLAS / QUOTE RECORD</span><span>{t("footerNote")}</span></footer>
  </div>;
}

function ActionForm({ action, locale, quoteId, idempotencyKey, label, help, secondary = false }: {
  action: (formData: FormData) => Promise<void>;
  locale: string;
  quoteId: string;
  idempotencyKey: string;
  label: string;
  help?: string;
  secondary?: boolean;
}) {
  return <form action={action} className="quote-action-form">
    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="quoteId" value={quoteId} /><input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    {help && <p>{help}</p>}
    <button className={secondary ? "order-secondary-button" : "order-primary-button"} type="submit">{label} {secondary ? null : <ArrowRight size={15} />}</button>
  </form>;
}
