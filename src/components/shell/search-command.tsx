"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Command, Search, X } from "lucide-react";

export function SearchCommand({ locale, showCustomers, showOrders, showQuotes }: { locale: string; showCustomers: boolean; showOrders: boolean; showQuotes: boolean }) {
  const t = useTranslations("common");
  const nav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const links = useMemo(() => [
    { label: nav("overview"), href: `/${locale}/dashboard`, icon: Search },
    ...(showCustomers ? [{ label: nav("sales"), href: `/${locale}/sales/customers`, icon: Search }] : []),
    ...(showQuotes ? [{ label: nav("quotes"), href: `/${locale}/sales/quotes`, icon: Search }] : []),
    ...(showOrders ? [{ label: nav("orders"), href: `/${locale}/sales/orders`, icon: Search }] : []),
    { label: nav("copilot"), href: `/${locale}/copilot`, icon: Command },
  ].filter((link) => link.label.toLowerCase().includes(query.trim().toLowerCase())), [locale, nav, query, showCustomers, showOrders, showQuotes]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <>
      <button className="search-trigger" onClick={() => { setQuery(""); setOpen(true); }} aria-label={t("search")}>
      <Search size={16} /><span>{t("search")}</span>
    </button>
    {open && <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="command-dialog" role="dialog" aria-modal="true" aria-label={t("search")}>
        <div className="command-input"><Search size={18} /><input autoFocus value={query} placeholder={t("search")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} /><button className="icon-button" aria-label={t("close")} onClick={() => setOpen(false)}><X size={17} /></button></div>
        <p className="command-heading">{t("navigation")}</p>
        {links.map(({ label, href, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)}><span className="command-result-icon"><Icon size={15} /></span>{label}<kbd>↵</kbd></Link>)}
        {links.length === 0 && <p className="command-empty">{t("noPages")}</p>}
        <p className="command-footer">{t("navigationOnly")}</p>
      </section>
    </div>}
  </>;
}
