import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { isAppRole } from "./permissions";

export async function getSession() {
  // Resolve the request-time API before initializing auth/database configuration.
  // This keeps protected dynamic routes out of the static build when deployment
  // environment variables have not been loaded into a prerender worker.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || !isAppRole(session.user.appRole)) return null;
  return session;
}

export async function requireSession(locale: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  return session;
}
