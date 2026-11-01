import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Building2, MapPin, PackageCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { parseCustomerFilters } from "@/lib/customers/filters";
import { can, isAppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getCustomerDetail } from "@/server/queries/customers";
import { z } from "zod";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  if (!isAppRole(session.user.appRole) || !session.user.organizationId || !can(session.user.appRole, "customers:read") || !z.uuid().safeParse(id).success) notFound();
  const detail = await getCustomerDetail({ organizationId: session.user.organizationId, role: session.user.appRole, customerId: id });
  if (!detail) notFound();
  const t = await getTranslations("customers");
  const orderT = await getTranslations("orders");
  const from = parseCustomerFilters(await searchParams);
  const backQuery = new URLSearchParams();
  if (from.success) {
    if (from.data.q) backQuery.set("q", from.data.q);
    if (from.data.segment !== "all") backQuery.set("segment", from.data.segment);
    if (from.data.page > 1) backQuery.set("page", String(from.data.page));
  }
  const backHref = `/${locale}/sales/customers${backQuery.size ? `?${backQuery}` : ""}`;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Casablanca" }).format(value);
  const statusLabels = {
    draft: orderT("statusLabels.draft"), confirmed: orderT("statusLabels.confirmed"), shipped: orderT("statusLabels.shipped"),
    invoiced: orderT("statusLabels.invoiced"), paid: orderT("statusLabels.paid"), cancelled: orderT("statusLabels.cancelled"),
  };

  return <div className="customer-detail-page">
    <Link className="back-link" href={backHref}><ArrowLeft size={15} /> {t("backToCustomers")}</Link>
    <section className="customer-profile-heading">
      <div className="customer-profile-avatar" aria-hidden="true">{detail.customer.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div>
      <div className="customer-profile-copy"><p className="page-kicker">ATLAS / SALES / {t("customerRecord")}</p><h1>{detail.customer.name}</h1><p className="page-subtitle">{t(`segments.${detail.customer.segment}`)} <span aria-hidden="true">·</span> {detail.customer.city}</p></div>
      <span className={`customer-segment segment-${detail.customer.segment.toLowerCase()}`}>{t(`segments.${detail.customer.segment}`)}</span>
    </section>

    <section className="customer-facts-grid" aria-label={t("accountDetails")}>
      <article><span><MapPin size={15} /> {t("city")}</span><strong>{detail.customer.city}</strong><small>{t("operatingCity")}</small></article>
      <article><span><Building2 size={15} /> {t("segment")}</span><strong>{t(`segments.${detail.customer.segment}`)}</strong><small>{t("customerType")}</small></article>
      <article><span><PackageCheck size={15} /> {t("orders")}</span><strong>{number(detail.orderCount)}</strong><small>{t("ordersOnRecord")}</small></article>
      <article><span>{t("paymentTerms")}</span><strong>{number(detail.customer.paymentTermsDays)} {t("days")}</strong><small>{t("termsDescription")}</small></article>
    </section>

    <section className="customer-history-section">
      <div className="section-heading"><div><div className="section-title-line"><h2>{t("orderHistory")}</h2><span className="table-count">{String(detail.orderCount).padStart(2, "0")}</span></div><p>{t("historyDescription")}</p></div></div>
      <div className="table-frame"><div className="table-scroll"><table className="product-table customer-history-table">
        <thead><tr><th>{t("order")}</th><th>{t("date")}</th><th>{t("status")}</th><th scope="col" aria-label={t("openOrder")} /></tr></thead>
        <tbody>{detail.orders.map((order) => <tr key={order.id}><td><Link className="order-number-link" href={`/${locale}/sales/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{date(order.orderDate)}</td><td><span className={`order-status status-${order.status}`}>{statusLabels[order.status as keyof typeof statusLabels] ?? order.status}</span></td><td><Link className="row-open-link" href={`/${locale}/sales/orders/${order.id}`} aria-label={`${t("openOrder")} ${order.orderNumber}`}><ArrowUpRight size={16} /></Link></td></tr>)}</tbody>
      </table>{detail.orders.length === 0 && <div className="table-empty">{t("noOrders")}</div>}</div>
        {detail.orderCount > detail.orders.length && <div className="customer-history-note">{t("recentOrdersOnly", { count: detail.orders.length, total: detail.orderCount })}</div>}
      </div>
    </section>
    <footer className="page-note"><span>ATLAS / CUSTOMER RECORD</span><span>{t("createdOn", { date: date(detail.customer.createdAt) })}</span></footer>
  </div>;
}
