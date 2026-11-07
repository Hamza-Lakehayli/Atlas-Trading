"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";

export function LanguageSwitch({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const next = locale === "en" ? "fr" : "en";
  const nextLanguage = next === "fr" ? t("french") : t("english");
  return <button className="icon-button language-button" aria-label={`${next.toUpperCase()} — ${t("switchLanguage", { language: nextLanguage })}`} title={nextLanguage} onClick={() => router.replace(pathname, { locale: next })}><Languages size={16} /><span>{next.toUpperCase()}</span></button>;
}
