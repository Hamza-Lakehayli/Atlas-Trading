import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { can, isAppRole } from "@/server/auth/permissions";
import { listProducts } from "@/server/queries/products";
import { withRequestTrace } from "@/server/observability/query-trace";
import { ProductTable } from "@/components/inventory/product-table";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CircleHelp, PackageCheck } from "lucide-react";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession(locale);
  const role = session.user.appRole;
  const organizationId = session.user.organizationId;
  if (!isAppRole(role) || !organizationId || !can(role, "inventory:read")) redirect(`/${locale}/login`);
  const t = await getTranslations("dashboard");
  const products = await withRequestTrace(() => listProducts({
    organizationId,
    role,
  }));
  const activeCount = products.total;
  const lowStockCount = products.lowStock;

  return <div className="dashboard-page">
    <section className="welcome-row">
      <div><p className="page-kicker">{new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Casablanca" }).format(new Date())} <span>·</span> {t("city")}</p><h1>{t("title", { name: session.user.name.split(" ")[0] })}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <div className="period-control" aria-label={t("period")}><CalendarDays size={16} /><span>{t("period")}</span><span className="control-chevron">⌄</span></div>
    </section>

    <section className="metric-strip" aria-label="Inventory summary">
      <article className="metric-block"><div className="metric-label">{t("activeProducts")} <CircleHelp size={13} /></div><div className="metric-value">{activeCount.toLocaleString(locale)}</div><div className="metric-note"><PackageCheck size={14} /> {t("catalogueCount")}</div></article>
      <article className="metric-block"><div className="metric-label">{t("lowStockMetric")} <CircleHelp size={13} /></div><div className="metric-value">{lowStockCount.toLocaleString(locale)}</div><div className="metric-note metric-warning"><ArrowDownRight size={14} /> {t("reorderPoint")}</div></article>
      <article className="metric-block"><div className="metric-label">{t("dataConnection")} <CircleHelp size={13} /></div><div className="metric-value metric-connected"><span /> {t("live")}</div><div className="metric-note"><ArrowUpRight size={14} /> PostgreSQL · {t("seededDataset")}</div></article>
      <div className="metric-aside"><span className="aside-line" /><span>{t("dashboardPrinciple")}</span></div>
    </section>

    <section className="catalog-section">
      <div className="section-heading"><div><div className="section-title-line"><h2>{t("products")}</h2><span className="table-count">{activeCount.toString().padStart(3, "0")}</span></div><p>{t("productsDescription")}</p></div><button className="quiet-button" disabled>{t("manageCatalogue")} <span>↗</span></button></div>
      <ProductTable products={products.rows} locale={locale} showPrices={products.showPrices} />
    </section>
    <footer className="page-note"><span>ATLAS / {t("inventorySnapshot")}</span><span>{t("comingViews")}</span></footer>
  </div>;
}
