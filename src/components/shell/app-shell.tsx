import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppRole } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { SearchCommand } from "@/components/shell/search-command";
import { ActiveNavLink } from "@/components/shell/active-nav-link";
import { CurrentBreadcrumb } from "@/components/shell/current-breadcrumb";
import { ChartNoAxesCombined, CircleDollarSign, Command, Construction, LayoutDashboard, LockKeyhole, PackageSearch, UsersRound } from "lucide-react";

type SessionUser = { name: string; email: string; appRole: string };

export async function AppShell({ children, locale, user }: {
  children: React.ReactNode;
  locale: string;
  user: SessionUser;
}) {
  const t = await getTranslations("nav");
  const loginT = await getTranslations("login");
  const role = user.appRole as AppRole;
  const roleKey = ({ admin: "admin", sales_manager: "salesManager", warehouse: "warehouse", accountant: "accountant", viewer: "viewer" } as const)[role];
  const primary = [
    { label: t("overview"), href: `/${locale}/dashboard`, icon: LayoutDashboard, active: true },
    { label: t("sales"), href: `/${locale}/sales/customers`, icon: ChartNoAxesCombined, permission: "customers:read" },
    { label: t("orders"), href: `/${locale}/sales/orders`, icon: PackageSearch, permission: "orders:read" },
    { label: t("inventory"), href: `/${locale}/dashboard`, icon: PackageSearch, permission: "inventory:read", disabled: true },
    { label: t("finance"), href: `/${locale}/dashboard`, icon: CircleDollarSign, permission: "dashboard:finance:read", disabled: true },
  ];

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label={t("primaryNavigation")}>
        <Link href={`/${locale}/dashboard`} className="sidebar-brand" aria-label="Atlas Trading Co. home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>ATLAS <b>TRADING CO.</b></span>
        </Link>
        <div className="org-switcher"><span className="org-avatar">AT</span><span><b>Atlas Trading Co.</b><small>Morocco · MAD</small></span><span className="org-chevron" aria-hidden="true">⌄</span></div>
        <p className="nav-label">{t("workspace")}</p>
        <nav className="main-nav" aria-label={t("workspace")}>
          {primary.filter((item) => !item.permission || can(role, item.permission)).map((item) => {
            const Icon = item.icon;
            return item.disabled ? (
              <span key={item.label} className="nav-item nav-disabled" aria-disabled="true" title={t("availableSoon")}>
                <Icon size={17} /><span>{item.label}</span><span className="nav-lock"><LockKeyhole size={12} /></span>
              </span>
            ) : (
              <ActiveNavLink key={item.label} href={item.href}><Icon size={17} /><span>{item.label}</span></ActiveNavLink>
            );
          })}
        </nav>
        <p className="nav-label admin-label">{t("administration")}</p>
        <div className="main-nav">
          {can(role, "users:manage") && <span className="nav-item nav-disabled" aria-disabled="true"><UsersRound size={17} /><span>{t("users")}</span><span className="nav-lock"><LockKeyhole size={12} /></span></span>}
          {can(role, "audit:read") && <span className="nav-item nav-disabled" aria-disabled="true"><Construction size={17} /><span>{t("audit")}</span><span className="nav-lock"><LockKeyhole size={12} /></span></span>}
          <Link href={`/${locale}/copilot`} className="nav-item copilot-nav"><Command size={17} /><span>{t("copilot")}</span><span className="planned-pill">SOON</span></Link>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-role"><span className="role-presence" /><span><b>{user.name}</b><small>{loginT(`roles.${roleKey}`)}</small></span></div>
          <div className="sidebar-actions"><LanguageSwitch locale={locale} /><ThemeSwitch /><SignOutButton /></div>
          <div className="sidebar-version"><span>ATLAS ERP</span><span>FOUNDATIONS / 01</span></div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <CurrentBreadcrumb locale={locale} labels={{ overview: t("overview"), customers: t("customers"), orders: t("orders"), copilot: t("copilot") }} />
          <div className="topbar-actions"><SearchCommand locale={locale} showOrders={can(role, "orders:read")} /><span className="mobile-top-actions"><LanguageSwitch locale={locale} /><ThemeSwitch /><SignOutButton /></span><span className="topbar-divider" /><span className="topbar-user">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span></div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
