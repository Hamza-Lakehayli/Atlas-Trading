import { getTranslations } from "next-intl/server";
import { Command, Scale, ServerOff } from "lucide-react";

export default async function CopilotPlaceholder() {
  const t = await getTranslations("copilot");
  return <section className="placeholder-page">
    <div className="placeholder-mark"><Command size={23} strokeWidth={1.6} /></div>
    <p className="page-kicker">FUTURE CAPABILITY / NOT CONNECTED</p>
    <h1>{t("title")}</h1>
    <p className="placeholder-description">{t("description")}</p>
    <div className="placeholder-info"><div className="placeholder-info-icon"><Scale size={17} /></div><div><h2>{t("futureTitle")}</h2><p>{t("futureDescription")}</p></div><ServerOff className="server-off" size={17} /></div>
    <p className="placeholder-footnote">No model requests are sent. This page is a placeholder, not a working assistant.</p>
  </section>;
}
