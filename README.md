# Atlas Trading Co. ERP showcase

A personal portfolio ERP for a fictional Moroccan wholesale distributor. **Develop locally with native PostgreSQL, without Docker.** Later: normal GitHub repository → Vercel Hobby + Neon Free. No cloud provisioning or deployment now.

## Development setup

Requirements: Node.js 22 LTS, npm, and native PostgreSQL binaries. PostgreSQL 16 is installed on this development machine.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local` if it does not exist. Configure a random `BETTER_AUTH_SECRET` (at least 32 characters) and the documented public demo settings.
3. Run `npm run db:local:start`. This creates/starts only the project-owned cluster in ignored `.local/postgres`, listening on `127.0.0.1:5433`, and writes private database URLs to ignored `.env.development.local`. It does not change the existing PostgreSQL service on port 5432. Set `PG_BIN_DIR` if binaries are installed elsewhere; non-Windows environments can use binaries on PATH.
4. Run `npm run db:check`, then `npm run db:setup` to apply migrations and seed this project database.
5. Run `npm run dev` and open `http://localhost:3000/en/login` or `/fr/login`.

Stop the project database with `npm run db:local:stop`; this preserves its data. Next.js and CLI scripts load `.env.development.local` before `.env.local` for development. If using your own local database instead, set both database URLs to it in the development override; the helper refuses to overwrite a different URL.

Keep `.env.local` out of Git. Never paste database URLs or auth secrets into chat. Demo credentials are intentionally public showcase credentials, not suitable for real accounts. Public registration is disabled.

This Windows checkout currently uses webpack because the installed native SWC module cannot load here. See [ADR 0004](docs/adr/0004-windows-webpack-fallback.md). This does not require a container or prevent Vercel deployment.

## Deploy from GitHub

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): push this repository to your GitHub account, import it into Vercel on Hobby using the Next.js preset, and configure environment variables for your managed database. Build with `npm run build`; do not add seeding or migrations to that build command. No paid upgrade is part of this setup.

Vercel runs the web app and server functions; it is not the persistent database. Neon hosts PostgreSQL separately. Preview/development databases must not share production credentials.

## Current status

Foundations and the transaction-safe order-to-payment vertical slice are verified against local PostgreSQL. Milestone 1 continues with customer/quote/invoice screens and URL-driven executive analytics. Full Inventory/Finance modules remain later. Copilot is an informational placeholder with no AI calls or runtime.

## Quality commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run db:check
npm run verify:foundations
npm run verify:orders
```

PR CI runs lint, types, unit tests, and a build without live database secrets. Managed database integration testing is separate and must use an isolated, trusted test environment.

`verify:foundations` requires the running local app and seeded project database. It checks seed counts, every role's login/dashboard, French routes, warehouse price restrictions, the inactive copilot, and logout. It refuses remote targets and never prints credentials/session cookies.

`verify:orders` uses a unique temporary organization in local PostgreSQL and removes only that test organization's records. It checks draft edits, role enforcement, insufficient-stock rollback, concurrent idempotency, invoice totals, partial payments, and settlement.

`verify:orders` uses a unique temporary organization in local PostgreSQL and removes only that test organization's records. It checks draft editing, role enforcement, insufficient-stock rollback, concurrent idempotency, invoice totals, partial payments, and settlement.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), the [product spec](spec/ERP%20Showcase%20%E2%80%94%20Product%20%26%20Technical%20Spec.md), and [ADR 0005](docs/adr/0005-github-vercel-hobby-managed-database.md).
