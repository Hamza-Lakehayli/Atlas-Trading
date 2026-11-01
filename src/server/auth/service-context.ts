import "server-only";
import { getSession } from "./session";
import { isAppRole } from "./permissions";
import type { ServiceContext } from "@/server/services/orders";

export async function getServiceContext(): Promise<ServiceContext> {
  const session = await getSession();
  if (!session || !isAppRole(session.user.appRole) || !session.user.organizationId) {
    throw new Error("FORBIDDEN");
  }
  return {
    actorId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.appRole,
  };
}
