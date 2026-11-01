import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getOrderCreationOptions, listSalesOrders } from "@/server/queries/orders";
import { createOrderAction } from "./actions";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> };

export default async function SalesOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId) notFound();
  const role = session.user.appRole;
  if (!can(role, "orders:read")) notFound();
  const t = await getTranslations("orders");
  const { error } = await searchParams;
  const rows = await listSalesOrders({ organizationId: session.user.organizationId, role });
  const options = role === "admin" || role === "sales_manager"
    ? await getOrderCreationOptions({ organizationId: session.user.organizationId, role })
    : null;
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "Africa/Casablanca" }).format(value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 0 }).format(minor / 100);
  const errorMessages = {
    VALIDATION_ERROR: t("errors.VALIDATION_ERROR"), FORBIDDEN: t("errors.FORBIDDEN"), NOT_FOUND: t("errors.NOT_FOUND"),
    CONFLICT: t("errors.CONFLICT"), INSUFFICIENT_STOCK: t("errors.INSUFFICIENT_STOCK"),
    INVALID_TRANSITION: t("errors.INVALID_TRANSITION"), INTERNAL: t("errors.INTERNAL"),
  };
  const statusLabels = {
    draft: t("statusLabels.draft"), confirmed: t("statusLabels.confirmed"), shipped: t("statusLabels.shipped"),
    invoiced: t("statusLabels.invoiced"), paid: t("statusLabels.paid"), cancelled: t("statusLabels.cancelled"),
  };

  return <div className="orders-page">
    <section className="welcome-row">
      <div><p className="page-kicker">ATLAS / SALES</p><h1>{t("title")}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <span className="orders-record-count"><ClipboardList size={15} /> {rows.length} / 100</span>
    </section>

    {error && <p className="order-alert" role="alert">{errorMessages[error as keyof typeof errorMessages] ?? errorMessages.INTERNAL}</p>}

    {options && <section className="order-create-panel">
      <div className="order-panel-heading"><div><span className="order-panel-mark">+</span><div><h2>{t("newOrder")}</h2><p>{t("createHelp")}</p></div></div><span className="draft-label">DRAFT</span></div>
      <form action={createOrderAction} className="order-create-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <label><span>{t("customer")}</span><select required name="customerId" defaultValue=""><option value="" disabled>{t("chooseCustomer")}</option>{options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label><span>{t("warehouse")}</span><select required name="warehouseId" defaultValue=""><option value="" disabled>{t("chooseWarehouse")}</option>{options.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label className="order-product-field"><span>{t("product")}</span><select required name="productId" defaultValue=""><option value="" disabled>{t("chooseProduct")}</option>{options.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
        <label className="order-quantity-field"><span>{t("quantity")}</span><input required name="quantity" type="number" min="1" max="999" defaultValue="1" /></label>
        <button className="order-primary-button" type="submit">{t("create")} <ArrowUpRight size={15} /></button>
      </form>
    </section>}

    <section className="orders-list-section">
      <div className="section-heading"><div><div className="section-title-line"><h2>{t("orders")}</h2><span className="table-count">{rows.length.toString().padStart(2, "0")}</span></div><p>{t("listDescription")}</p></div></div>
      <div className="table-frame"><div className="table-scroll"><table className="product-table orders-table">
        <thead><tr><th>{t("number")}</th><th>{t("customer")}</th><th>{t("date")}</th><th>{t("status")}</th><th className="align-right">{t("items")}</th>{rows.some((row) => row.totalMinor !== null) && <th className="align-right">{t("total")}</th>}<th><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{rows.map((order) => <tr key={order.id}>
          <td><Link className="order-number-link" href={`/${locale}/sales/orders/${order.id}`}>{order.orderNumber}</Link></td>
          <td>{order.customerName}</td><td>{date(order.orderDate)}</td>
          <td><span className={`order-status status-${order.status}`}>{statusLabels[order.status as keyof typeof statusLabels] ?? order.status}</span></td>
          <td className="align-right">{order.itemCount}</td>
          {rows.some((row) => row.totalMinor !== null) && <td className="align-right money-cell">{order.totalMinor === null ? "—" : money(order.totalMinor)}</td>}
          <td><Link className="row-open-link" href={`/${locale}/sales/orders/${order.id}`} aria-label={`${t("openOrder")} ${order.orderNumber}`}><ArrowUpRight size={16} /></Link></td>
        </tr>)}</tbody>
      </table>{rows.length === 0 && <div className="table-empty">{t("empty")}</div>}</div>
      <div className="table-pagination"><span>{t("maxRows")}</span><span>{rows.length}</span></div></div>
    </section>
    <footer className="page-note"><span>ATLAS / SALES ORDERS</span><span>{t("paymentNote")}</span></footer>
  </div>;
}
