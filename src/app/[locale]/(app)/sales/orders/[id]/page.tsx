import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, CircleDollarSign, PackageCheck, ReceiptText } from "lucide-react";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getOrderCreationOptions, getSalesOrderDetail } from "@/server/queries/orders";
import { cancelOrderAction, confirmOrderAction, issueInvoiceAction, recordPaymentAction, shipOrderAction, updateDraftOrderAction } from "../actions";

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ error?: string }> };

export default async function SalesOrderDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId) notFound();
  if (!can(session.user.appRole, "orders:read") || !z.uuid().safeParse(id).success) notFound();
  const detail = await getSalesOrderDetail({ organizationId: session.user.organizationId, role: session.user.appRole, orderId: id });
  if (!detail) notFound();
  const t = await getTranslations("orders");
  const editOptions = detail.order.status === "draft" && detail.canConfirm
    ? await getOrderCreationOptions({ organizationId: session.user.organizationId, role: session.user.appRole })
    : null;
  const { error } = await searchParams;
  const { order, lines, invoice } = detail;
  const statusLabels = {
    draft: t("statusLabels.draft"), confirmed: t("statusLabels.confirmed"), shipped: t("statusLabels.shipped"),
    invoiced: t("statusLabels.invoiced"), paid: t("statusLabels.paid"), cancelled: t("statusLabels.cancelled"),
  };
  const invoiceStatusLabels = { unpaid: t("invoiceStatus.unpaid"), partial: t("invoiceStatus.partial"), paid: t("invoiceStatus.paid") };
  const errorMessages = {
    VALIDATION_ERROR: t("errors.VALIDATION_ERROR"), FORBIDDEN: t("errors.FORBIDDEN"), NOT_FOUND: t("errors.NOT_FOUND"),
    CONFLICT: t("errors.CONFLICT"), INSUFFICIENT_STOCK: t("errors.INSUFFICIENT_STOCK"),
    INVALID_TRANSITION: t("errors.INVALID_TRANSITION"), INTERNAL: t("errors.INTERNAL"),
  };
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca" }).format(value);
  const orderTotal = detail.financial
    ? lines.reduce((sum, line) => sum + line.quantity * (line.unitPriceMinor ?? 0), 0)
    : null;
  const outstanding = invoice ? invoice.totalMinor - invoice.paidMinor : 0;
  const errorKey = error && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INSUFFICIENT_STOCK", "INVALID_TRANSITION", "INTERNAL"].includes(error)
    ? error : null;

  return <div className="order-detail-page">
    <Link className="back-link" href={`/${locale}/sales/orders`}><ArrowLeft size={15} /> {t("backToOrders")}</Link>
    {errorKey && <p className="order-alert" role="alert">{errorMessages[errorKey as keyof typeof errorMessages] ?? errorMessages.INTERNAL}</p>}
    <section className="order-detail-heading">
      <div><p className="page-kicker">ATLAS / SALES / {order.orderNumber}</p><h1>{order.orderNumber}</h1><p className="page-subtitle">{order.customerName} <span aria-hidden="true">·</span> {order.warehouseName}</p></div>
      <div className="order-heading-meta"><span className={`order-status status-${order.status}`}>{statusLabels[order.status as keyof typeof statusLabels] ?? order.status}</span><span>{date(order.orderDate)}</span></div>
    </section>

    <div className="order-detail-grid">
      <div className="order-main-column">
        {editOptions && detail.lines.length <= 1 && <section className="order-content-panel draft-edit-panel">
          <div className="order-content-title"><div><h2>{t("editDraft")}</h2><p>{t("editDraftHelp")}</p></div></div>
          <form action={updateDraftOrderAction} className="draft-edit-form">
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label><span>{t("customer")}</span><select name="customerId" defaultValue={order.customerId} required>{editOptions.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label><span>{t("warehouse")}</span><select name="warehouseId" defaultValue={order.warehouseId} required>{editOptions.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
            <label><span>{t("product")}</span><select name="productId" defaultValue={detail.lines[0]?.productId ?? ""} required>{editOptions.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
            <label><span>{t("quantity")}</span><input type="number" name="quantity" min="1" max="999" defaultValue={detail.lines[0]?.quantity ?? 1} required /></label>
            <button className="order-primary-button" type="submit">{t("saveDraft")}</button>
          </form>
        </section>}
        <section className="order-content-panel">
          <div className="order-content-title"><div><h2>{t("lines")}</h2><p>{lines.length} {t("lineCount")}</p></div>{orderTotal !== null && <strong>{money(orderTotal)}</strong>}</div>
          <div className="table-scroll"><table className="product-table order-lines-table"><thead><tr><th>{t("product")}</th><th className="align-right">{t("quantity")}</th>{detail.financial && <><th className="align-right">{t("unitPrice")}</th><th className="align-right">{t("lineTotal")}</th></>}</tr></thead>
            <tbody>{lines.map((line) => <tr key={line.id}><td><div className="order-product-name"><span className="sku-code">{line.sku}</span><strong>{line.productName}</strong></div></td><td className="align-right">{line.quantity}</td>{detail.financial && <><td className="align-right money-cell">{line.unitPriceMinor === undefined ? "—" : money(line.unitPriceMinor)}</td><td className="align-right money-cell">{line.unitPriceMinor === undefined ? "—" : money(line.unitPriceMinor * line.quantity)}</td></>}</tr>)}</tbody>
          </table></div>
        </section>

        {invoice && <section className="order-content-panel invoice-panel">
          <div className="order-content-title"><div><h2><ReceiptText size={17} /> {t("invoiceTitle", { number: invoice.number })}</h2><p>{invoiceStatusLabels[invoice.status as keyof typeof invoiceStatusLabels] ?? invoice.status}</p></div><strong>{money(invoice.totalMinor)}</strong></div>
          <div className="invoice-facts"><div><span>{t("dueDate")}</span><b>{date(invoice.dueDate)}</b></div><div><span>{t("paid")}</span><b>{money(invoice.paidMinor)}</b></div><div><span>{t("outstanding")}</span><b>{money(outstanding)}</b></div></div>
          <p className="payment-note">{t("paymentNote")}</p>
        </section>}

        <section className="order-content-panel timeline-panel">
          <div className="order-content-title"><div><h2>{t("timeline")}</h2><p>{t("timelineDescription")}</p></div></div>
          <ol className="order-timeline">
            <li className="timeline-complete"><span><Check size={13} /></span><div><b>{statusLabels.draft}</b><small>{t("createdAt", { date: date(order.orderDate) })}</small></div></li>
            {order.confirmedAt && <li className="timeline-complete"><span><Check size={13} /></span><div><b>{statusLabels.confirmed}</b><small>{date(order.confirmedAt)}</small></div></li>}
            {order.shippedAt && <li className="timeline-complete"><span><PackageCheck size={13} /></span><div><b>{statusLabels.shipped}</b><small>{date(order.shippedAt)}</small></div></li>}
            {order.invoicedAt && <li className="timeline-complete"><span><ReceiptText size={13} /></span><div><b>{statusLabels.invoiced}</b><small>{date(order.invoicedAt)}</small></div></li>}
            {order.paidAt && <li className="timeline-complete"><span><CircleDollarSign size={13} /></span><div><b>{statusLabels.paid}</b><small>{date(order.paidAt)}</small></div></li>}
            {order.cancelledAt && <li className="timeline-cancelled"><span>×</span><div><b>{statusLabels.cancelled}</b><small>{date(order.cancelledAt)}</small></div></li>}
          </ol>
        </section>
      </div>

      <aside className="order-actions-column">
        <section className="order-content-panel action-panel">
          <div className="order-content-title"><div><h2>{t("actions")}</h2><p>{t("actionGuardrail")}</p></div></div>
          {order.status === "draft" && detail.canConfirm && <ActionForm action={confirmOrderAction} locale={locale} orderId={order.id} idempotencyKey={randomUUID()} label={t("confirm")} />}
          {order.status === "confirmed" && detail.canShip && <ActionForm action={shipOrderAction} locale={locale} orderId={order.id} idempotencyKey={randomUUID()} label={t("ship")} />}
          {order.status === "shipped" && detail.canInvoice && <ActionForm action={issueInvoiceAction} locale={locale} orderId={order.id} idempotencyKey={randomUUID()} label={t("invoice")} />}
          {order.status === "invoiced" && detail.canPay && invoice && outstanding > 0 && <form action={recordPaymentAction} className="record-payment-form">
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label><span>{t("paymentAmount")}</span><input name="amount" inputMode="decimal" type="text" pattern="(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?" defaultValue={(outstanding / 100).toFixed(2)} required /></label>
            <label><span>{t("paymentMethod")}</span><select name="method" defaultValue="bank_transfer"><option value="bank_transfer">{t("bank_transfer")}</option><option value="cash">{t("cash")}</option><option value="check">{t("check")}</option><option value="other">{t("other")}</option></select></label>
            <button className="order-primary-button" type="submit">{t("recordPayment")} <ArrowRight size={15} /></button>
          </form>}
          {(order.status === "draft" || order.status === "confirmed") && detail.canCancel && <ActionForm action={cancelOrderAction} locale={locale} orderId={order.id} idempotencyKey={randomUUID()} label={t("cancel")} secondary />}
          {!detail.canConfirm && !detail.canShip && !detail.canInvoice && !detail.canPay && <p className="order-readonly-note">{t("noActions")}</p>}
          {order.status === "paid" && <p className="order-readonly-note">{t("settled")}</p>}
        </section>
        <section className="order-content-panel customer-facts"><h2>{t("customer")}</h2><p>{order.customerName}</p><span>{t("warehouse")}</span><p>{order.warehouseName}</p></section>
      </aside>
    </div>
  </div>;
}

function ActionForm({ action, locale, orderId, idempotencyKey, label, secondary = false }: {
  action: (formData: FormData) => Promise<void>;
  locale: string;
  orderId: string;
  idempotencyKey: string;
  label: string;
  secondary?: boolean;
}) {
  return <form action={action} className="single-order-action">
    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="orderId" value={orderId} /><input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <button className={secondary ? "order-secondary-button" : "order-primary-button"} type="submit">{label} {secondary ? null : <ArrowRight size={15} />}</button>
  </form>;
}
