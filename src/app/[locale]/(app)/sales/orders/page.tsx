import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, ArrowUpRight, ClipboardList, Search } from "lucide-react";
import { parseOrderFilters, type OrderFilters } from "@/lib/orders/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getOrderCreationOptions, getOrderFilterOptions, listSalesOrders } from "@/server/queries/orders";
import { createOrderAction } from "./actions";
import { OrderLineFields } from "@/components/sales/order-line-fields";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function orderQuery(filters: OrderFilters, page = filters.page) {
  const query = new URLSearchParams();
  for (const key of ["q", "status", "dateBasis", "from", "to", "customerId", "warehouseId", "categoryId", "segment", "sort", "direction"] as const) {
    const value = filters[key];
    if (value && !(key === "status" && value === "all") && !(key === "dateBasis" && value === "orderDate") && !(key === "sort" && value === "orderDate") && !(key === "direction" && value === "desc")) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  return query.toString();
}

export default async function SalesOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId) notFound();
  const role = session.user.appRole;
  if (!can(role, "orders:read")) notFound();
  const t = await getTranslations("orders");
  const rawParams = await searchParams;
  const error = rawParams.error;
  const orderFilterKeys = new Set(["q", "status", "dateBasis", "from", "to", "customerId", "warehouseId", "categoryId", "segment", "sort", "direction", "page", "error"]);
  const unknownFilters = Object.fromEntries(Object.entries(rawParams).filter(([key]) => !orderFilterKeys.has(key)));
  const parsed = parseOrderFilters({
    q: rawParams.q, status: rawParams.status, dateBasis: rawParams.dateBasis, from: rawParams.from, to: rawParams.to,
    customerId: rawParams.customerId, warehouseId: rawParams.warehouseId,
    categoryId: rawParams.categoryId, segment: rawParams.segment,
    sort: rawParams.sort, direction: rawParams.direction, page: rawParams.page,
    ...unknownFilters,
  });
  const filters = parsed.success ? parsed.data : null;
  const financialSortRestricted = Boolean(filters && filters.sort === "total" && !can(role, "dashboard:finance:read"));
  const result = filters && !financialSortRestricted ? await listSalesOrders({ organizationId: session.user.organizationId, role, filters }) : null;
  const rows = result?.rows ?? [];
  const categories = await getOrderFilterOptions({ organizationId: session.user.organizationId, role });
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
  const statuses = ["draft", "confirmed", "shipped", "invoiced", "paid", "cancelled"] as const;
  const listHref = (page: number) => {
    if (!filters) return `/${locale}/sales/orders`;
    const query = orderQuery(filters, page);
    return `/${locale}/sales/orders${query ? `?${query}` : ""}`;
  };

  return <div className="orders-page">
    <section className="welcome-row">
      <div><p className="page-kicker">ATLAS / SALES</p><h1>{t("title")}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <span className="orders-record-count"><ClipboardList size={15} /> {result ? `${result.total} ${t("orders")}` : t("invalidFilters")}</span>
    </section>

    {typeof error === "string" && <p className="order-alert" role="alert">{errorMessages[error as keyof typeof errorMessages] ?? errorMessages.INTERNAL}</p>}
    {(!parsed.success || financialSortRestricted) && <section className="customer-filter-error" role="alert"><strong>{financialSortRestricted ? t("financeSortRestricted") : t("invalidFilters")}</strong><span>{financialSortRestricted ? t("financeSortRestrictedHelp") : t("invalidFiltersHelp")}</span><Link href={`/${locale}/sales/orders`}>{t("clearFilters")}</Link></section>}

    {options && <section className="order-create-panel">
      <div className="order-panel-heading"><div><span className="order-panel-mark">+</span><div><h2>{t("newOrder")}</h2><p>{t("createHelp")}</p></div></div><span className="draft-label">DRAFT</span></div>
      <form action={createOrderAction} className="order-create-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <label><span>{t("customer")}</span><select required name="customerId" defaultValue=""><option value="" disabled>{t("chooseCustomer")}</option>{options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label><span>{t("warehouse")}</span><select required name="warehouseId" defaultValue=""><option value="" disabled>{t("chooseWarehouse")}</option>{options.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <OrderLineFields products={options.products} labels={{ product: t("product"), quantity: t("quantity"), chooseProduct: t("chooseProduct"), addLine: t("addLine"), additionalLine: t("additionalLine"), removeLine: t("removeLine") }} />
        <button className="order-primary-button order-create-submit" type="submit">{t("create")} <ArrowUpRight size={15} /></button>
      </form>
    </section>}

    {result && filters && <section className="orders-list-section">
      <div className="section-heading"><div><div className="section-title-line"><h2>{t("orders")}</h2><span className="table-count">{rows.length.toString().padStart(2, "0")}</span></div><p>{t("listDescription")}</p></div></div>
      <div className="table-frame">
        <form className="order-list-filters" action={`/${locale}/sales/orders`} method="get">
          <label className="customer-search"><Search size={15} /><span className="sr-only">{t("searchLabel")}</span><input name="q" type="search" maxLength={80} defaultValue={filters.q} placeholder={t("searchPlaceholder")} /></label>
          <label><span>{t("status")}</span><select name="status" defaultValue={filters.status}><option value="all">{t("allStatuses")}</option>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          <label><span>{t(filters.dateBasis === "confirmedAt" ? "confirmedFrom" : "from")}</span><input type="date" name="from" defaultValue={filters.from} /></label>
          <label><span>{t(filters.dateBasis === "confirmedAt" ? "confirmedTo" : "to")}</span><input type="date" name="to" defaultValue={filters.to} /></label>
          <label><span>{t("dateBasis")}</span><select name="dateBasis" defaultValue={filters.dateBasis}><option value="orderDate">{t("date")}</option><option value="confirmedAt">{t("confirmedDate")}</option></select></label>
          <label><span>{t("category")}</span><select name="categoryId" defaultValue={filters.categoryId ?? ""}><option value="">{t("allCategories")}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label><span>{t("segment")}</span><select name="segment" defaultValue={filters.segment ?? ""}><option value="">{t("allSegments")}</option><option value="Retail">{t("segments.Retail")}</option><option value="Hospitality">{t("segments.Hospitality")}</option><option value="Wholesale">{t("segments.Wholesale")}</option></select></label>
          {filters.customerId && <input type="hidden" name="customerId" value={filters.customerId} />}
          {filters.warehouseId && <input type="hidden" name="warehouseId" value={filters.warehouseId} />}
          <label><span>{t("sort")}</span><select name="sort" defaultValue={filters.sort}><option value="orderDate">{t("date")}</option><option value="orderNumber">{t("number")}</option><option value="customer">{t("customer")}</option><option value="status">{t("status")}</option>{can(role, "dashboard:finance:read") && <option value="total">{t("total")}</option>}</select></label>
          <label><span>{t("direction")}</span><select name="direction" defaultValue={filters.direction}><option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option></select></label>
          <button type="submit" className="customer-filter-button">{t("applyFilters")} <ArrowRight size={14} /></button>
          {(filters.q || filters.status !== "all" || filters.dateBasis !== "orderDate" || filters.from || filters.to || filters.customerId || filters.warehouseId || filters.categoryId || filters.segment) && <Link className="customer-clear-link" href={`/${locale}/sales/orders`}>{t("clearFilters")}</Link>}
        </form>
        <div className="table-scroll"><table className="product-table orders-table">
        <thead><tr><th>{t("number")}</th><th>{t("customer")}</th><th>{t(filters.dateBasis === "confirmedAt" ? "confirmedDate" : "date")}</th><th>{t("status")}</th><th className="align-right">{t("items")}</th>{rows.some((row) => row.totalMinor !== null) && <th className="align-right">{t("total")}</th>}<th><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{rows.map((order) => <tr key={order.id}>
          <td><Link className="order-number-link" href={`/${locale}/sales/orders/${order.id}${orderQuery(filters) ? `?${orderQuery(filters)}` : ""}`}>{order.orderNumber}</Link></td>
          <td>{order.customerName}</td><td>{date(filters.dateBasis === "confirmedAt" ? order.confirmedAt ?? order.orderDate : order.orderDate)}</td>
          <td><span className={`order-status status-${order.status}`}>{statusLabels[order.status as keyof typeof statusLabels] ?? order.status}</span></td>
          <td className="align-right">{order.itemCount}</td>
          {rows.some((row) => row.totalMinor !== null) && <td className="align-right money-cell">{order.totalMinor === null ? "—" : money(order.totalMinor)}</td>}
          <td><Link className="row-open-link" href={`/${locale}/sales/orders/${order.id}${orderQuery(filters) ? `?${orderQuery(filters)}` : ""}`} aria-label={`${t("openOrder")} ${order.orderNumber}`}><ArrowUpRight size={16} /></Link></td>
        </tr>)}</tbody>
      </table>{rows.length === 0 && <div className="table-empty">{t("empty")}</div>}</div>
      <nav className="customer-pagination" aria-label={t("pagination")}><span>{t("pageOf", { page: result.page, pages: Math.max(result.totalPages, 1) })}</span><div>
        {result.page > 1 ? <Link href={listHref(result.page - 1)} aria-label={t("previousPage")}><ArrowLeft size={15} /> {t("previous")}</Link> : <span aria-disabled="true"><ArrowLeft size={15} /> {t("previous")}</span>}
        {result.page < result.totalPages ? <Link href={listHref(result.page + 1)} aria-label={t("nextPage")}>{t("next")} <ArrowRight size={15} /></Link> : <span aria-disabled="true">{t("next")} <ArrowRight size={15} /></span>}
      </div></nav></div>
    </section>}
    <footer className="page-note"><span>ATLAS / SALES ORDERS</span><span>{t("paymentNote")}</span></footer>
  </div>;
}
