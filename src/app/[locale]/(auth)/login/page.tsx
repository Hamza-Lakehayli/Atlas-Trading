import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("login");

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>ATLAS <b>TRADING CO.</b></span>
        </div>
        <div className="story-copy">
          <p className="story-kicker">{t("eyebrow")}</p>
          <h1 id="login-title">{t("title")}</h1>
          <p className="story-description">{t("description")}</p>
        </div>
        <div className="port-illustration" aria-hidden="true">
          <div className="port-sun" />
          <div className="port-crane crane-one"><i /><span /><b /></div>
          <div className="port-crane crane-two"><i /><span /><b /></div>
          <div className="container-row"><i /><i /><i /><i /><i /></div>
          <div className="port-water"><span /><span /><span /></div>
          <div className="port-caption"><span>33° 35′ N</span><span>CASABLANCA · MOROCCO</span></div>
        </div>
        <p className="login-footnote">{t("subtitle")}</p>
      </section>

      <section className="login-panel" aria-labelledby="role-title">
        <div className="mobile-brand login-brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>ATLAS <b>TRADING CO.</b></span>
        </div>
        <div className="login-panel-content">
          <div className="session-status"><span /> {t("environment")}</div>
          <h2 id="role-title">{t("chooseRole")}</h2>
          <p className="login-help">{t("passwordNote")}</p>
          <LoginForm locale={locale} />
          <p className="login-security"><span aria-hidden="true" /> {t("resetNotice")}</p>
        </div>
        <div className="login-panel-bottom"><span>ATLAS / OPERATIONS</span><span>{t("version")}</span></div>
      </section>
    </main>
  );
}
