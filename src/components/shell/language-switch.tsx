"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";

export function LanguageSwitch({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = useLocale();
  const t = useTranslations("common");
  const next = locale === "en" ? "fr" : "en";
  return <button className="icon-button language-button" aria-label={`${t("language")}: ${current === "en" ? t("english") : t("french")}`} title={next === "fr" ? t("french") : t("english")} onClick={() => router.replace(pathname, { locale: next })}><Languages size={16} /><span>{next.toUpperCase()}</span></button>;
}
