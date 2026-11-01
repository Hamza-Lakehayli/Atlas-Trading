# ADR 0005: GitHub → Vercel Hobby, managed PostgreSQL only

> **Partially superseded by ADR 0006:** development now uses native local PostgreSQL. The managed-only/local-service prohibition below is historical; Vercel Hobby + Neon Free remains the later deployment target.

- **Status:** Accepted, explicit owner requirement
- **Decision date:** 2026-10-31
- **Supersedes:** local Docker/PostgreSQL setup in the original draft of ADR 0001 and the product spec.

## Decision

Keep a normal Next.js repository on GitHub. Import it into Vercel Hobby for the web application and Node.js server functions. Use Neon Free managed PostgreSQL, including when running `npm run dev` locally. No Docker, local PostgreSQL service, VM, or Azure resource is part of the workflow.

## Consequences

- Vercel hosting is not a database. Persistent records live in Neon; Vercel function memory and filesystem are not persistent storage.
- Application requests use the pooled Neon connection string with verified TLS. Operator-run migrations/checks use the direct connection string.
- Use a small `pg` pool and `attachDatabasePool` on Vercel to manage idle connections under Fluid compute.
- No migrations or seeds during build/startup/request handling. Apply reviewed migrations separately and seed the intended environment explicitly.
- Isolate preview/test data from production and respect the account's free branch/storage/compute limits.
- Simulation runs as bounded request-driven ticks; no always-on timer or worker.
- Future Vercel Hobby maintenance cron is at most daily, with invocation possible anywhere in the scheduled hour. It is not a precise nightly scheduler.
- No paid upgrades, resource creation, GitHub publishing, or live deployment is authorized merely by this architecture choice.

## Documentation checked

- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- https://vercel.com/docs/functions/limitations
- https://neon.com/docs/guides/drizzle
- https://neon.com/docs/introduction/plans

Provider quotas can change. Recheck them before release; treat performance budgets as measured goals, not a cold-start SLA.
