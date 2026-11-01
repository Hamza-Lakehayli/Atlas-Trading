"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ArrowUpRight, Boxes, ChartNoAxesCombined, CircleDollarSign, ShieldCheck, Warehouse } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const demoRoles = [
  { key: "admin", email: "admin@atlas.demo", icon: ShieldCheck },
  { key: "salesManager", email: "sales@atlas.demo", icon: ChartNoAxesCombined },
  { key: "warehouse", email: "warehouse@atlas.demo", icon: Warehouse },
  { key: "accountant", email: "finance@atlas.demo", icon: CircleDollarSign },
  { key: "viewer", email: "viewer@atlas.demo", icon: Boxes },
] as const;

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("login");
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function login(email: string, role: string) {
    setPending(role);
    setError(false);
    try {
      const result = await authClient.signIn.email({
        email,
        password: process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "",
        callbackURL: `/${locale}/dashboard`,
      });
      if (result.error) throw new Error("Sign-in failed");
      router.replace("/dashboard", { locale });
    } catch {
      setError(true);
      setPending(null);
    }
  }

  return (
    <div className="role-picker">
      {demoRoles.map(({ key, email, icon: Icon }) => (
        <button className="role-option" key={key} onClick={() => login(email, key)} disabled={pending !== null}>
          <span className="role-icon"><Icon size={18} strokeWidth={1.8} /></span>
          <span className="role-copy"><strong>{t(`roles.${key}`)}</strong><small>{email}</small></span>
          <span className="role-action">{pending === key ? <span className="loading-dot" /> : <ArrowUpRight size={17} />}</span>
        </button>
      ))}
      {pending && <p className="form-status" aria-live="polite">{t("busy")}</p>}
      {error && <p className="form-error" role="alert">{t("error")}</p>}
    </div>
  );
}
