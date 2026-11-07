import type { AppRole } from "@/server/auth/permissions";

export type ServiceContext = {
  actorId: string;
  organizationId: string;
  role: AppRole;
  now?: () => Date;
};
