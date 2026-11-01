# GitHub → Vercel Hobby + Neon Free

> Deployment is deferred. Develop against native local PostgreSQL for now (`npm run db:local:start`, `npm run db:setup`, `npm run dev`). The instructions below apply only when cloud deployment is requested; Neon is not a prerequisite for local work. See ADR 0006.

## Architecture

```text
GitHub repository → Vercel Hobby → Next.js pages and Node.js functions
                                       ↓ verified TLS
                                  Neon Free PostgreSQL
```

Deployment needs no Docker, VM, Azure service, or paid upgrade. Local development currently uses native PostgreSQL. Creating cloud resources or publishing/deploying still needs owner action/approval.

## 1. Managed database

In your Neon account, choose the Free plan and create/select a dedicated development database. Use the provider dashboard to copy both connection strings into `.env.local`:

- `DATABASE_URL`: pooled endpoint; Neon host includes `-pooler`.
- `DATABASE_URL_UNPOOLED`: direct endpoint for checks and migrations; no `-pooler`.

Both must point to the **same** database/branch when preparing one environment. Preserve the provider's SSL parameters. Never set `rejectUnauthorized: false`.

Run:

```sh
npm run db:check
npm run db:setup
```

`db:check` executes only `SELECT 1`. `db:setup` applies reviewed migrations then seeds demo data. These are operator commands, not web endpoints or Vercel build hooks. Full seed/reset lifecycle validation is still part of Milestone 0 completion.

Use a separate managed production database/branch for the public demo, subject to the account's free quotas. Never point development, tests, or preview mutations at production. If free quotas cannot support a separate preview database, leave database-backed previews disabled until an isolated environment is available.

## 2. Environment variables

| Variable | Usage |
| --- | --- |
| `DATABASE_URL` | Server-only pooled Neon URL for the selected environment. |
| `DATABASE_URL_UNPOOLED` | Direct URL in the trusted operator/migration environment; not required by application requests/builds. |
| `BETTER_AUTH_SECRET` | Random secret, at least 32 characters; separate between development and production. |
| `BETTER_AUTH_URL` | Exact origin: localhost during development, actual HTTPS Vercel/custom domain after deployment. |
| `NEXT_PUBLIC_APP_URL` | Public origin; match the selected deployment. |
| `DEMO_MODE` | Set explicitly to `true` only for the intentional public demo. Defaults to false. |
| `DEMO_PASSWORD` | Server-side seed credential for demo users. Not a real-user password. |
| `NEXT_PUBLIC_DEMO_PASSWORD` | The same intentionally public demo password used by one-click sign-in. It is embedded in the client bundle; never use an account secret here. |

No wildcard trust of every `*.vercel.app` origin. Configure exact deployment origins and isolated environment credentials. Secrets belong in local ignored files, Vercel settings, or protected GitHub secrets—not source control or chat.

## 3. Publish and import

1. Put source, migrations, and lockfile in a normal GitHub repository. Do not commit `.env.local`, `node_modules`, or `.next`.
2. Import the repository in Vercel under the Hobby plan.
3. Select **Next.js**, root directory `.`, Node.js **22.x**, install `npm ci`, build `npm run build`, and the default Next.js output directory.
4. Set Production environment variables. Set `BETTER_AUTH_URL` to the exact assigned domain; redeploy after changing build-time/public variables.
5. Apply reviewed production migrations and initial seeding from a trusted operator environment configured for the production demo database before testing login. No migration/seed in the build command.
6. Verify role login, logout, locale switching, protected routes, catalogue query, and the inactive copilot placeholder on the deployed URL.

The Vercel GitHub integration handles builds from repository changes. Do not publish a repo or create a Vercel/Neon project automatically without the owner's approval. Vercel's Hobby Git integration eligibility can differ for organization-owned repositories; use the owner's personal repository for this personal showcase and verify current restrictions before import.

## 4. Free-tier boundaries

- This is a personal, non-commercial portfolio app. Recheck Hobby eligibility for any commercial use.
- Database compute/storage/branch quotas and Vercel CPU/memory/request quotas are separate. Check current dashboards before release; 50k order lines plus indexes, audits, and aggregates must fit the actual free allowance.
- Small `pg` pools use Vercel's pool lifecycle hook; no persistent connections/timers are assumed to survive between requests.
- Simulation uses bounded, idempotent request-driven ticks. Pause polling on hidden tabs and stop it when the scenario pauses so Neon can scale to zero.
- Future maintenance may use one protected once-daily cron, with approximate invocation during the scheduled hour. No minute/hourly cron, exact-midnight guarantee, queue worker, or full historical seed inside a request.
- Do not configure cron until its route exists. Manual maintenance is the fallback if free limits are insufficient; upgrading is a separate owner decision.
- Cold starts can affect timings. Publish measured cold/warm performance, not a free-tier uptime/latency guarantee.

## 5. Later database configuration

The workspace uses an ignored development override for local PostgreSQL. Neon configuration remains a later task. Use a separate trusted environment for cloud migration commands so the local override cannot accidentally redirect them. Do not send credentials in chat. No managed resources or paid plans have been created.

## References

- https://vercel.com/docs/git/vercel-for-github
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- https://neon.com/docs/guides/drizzle
- https://neon.com/docs/introduction/plans
