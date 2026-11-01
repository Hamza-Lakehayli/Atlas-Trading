"use client";

import { useEffect } from "react";
import { Sun } from "lucide-react";
import { useTranslations } from "next-intl";

export function ThemeSwitch() {
  const t = useTranslations("common");
  useEffect(() => {
    const saved = localStorage.getItem("atlas-theme") === "dark";
    document.documentElement.dataset.theme = saved ? "dark" : "light";
  }, []);
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("atlas-theme", next ? "dark" : "light");
  }
  return <button className="icon-button" onClick={toggle} aria-label={t("toggleTheme")} title={t("toggleTheme")}><Sun size={16} /></button>;
}
