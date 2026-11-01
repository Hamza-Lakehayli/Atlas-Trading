import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { isAppRole } from "./permissions";

export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAppRole(session.user.appRole)) return null;
  return session;
}

export async function requireSession(locale: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  return session;
}
