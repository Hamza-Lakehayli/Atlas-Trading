"use client";

import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function SignOutButton() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  return <button className="icon-button" aria-label={t("signOut")} title={t("signOut")} onClick={async () => {
    await authClient.signOut();
    router.replace("/login", { locale });
  }}><LogOut size={16} /></button>;
}
