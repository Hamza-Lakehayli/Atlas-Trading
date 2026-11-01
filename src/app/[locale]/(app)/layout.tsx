import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/server/auth/session";

export default async function AppLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireSession(locale);
  return <AppShell locale={locale} user={session.user}>{children}</AppShell>;
}
