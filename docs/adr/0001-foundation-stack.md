# ADR 0001: Foundation stack

> Development setup updated by ADR 0006: native local PostgreSQL now; Vercel Hobby + Neon Free later. Docker is not used.

- **Status:** Accepted
- **Decision date:** 2026-10-31

## Decision

Use stable Next.js App Router, strict TypeScript, Tailwind CSS, PostgreSQL, Drizzle ORM, Better Auth, and next-intl. Keep a normal GitHub repository imported into Vercel Hobby (free tier), with Neon Free managed PostgreSQL for development and production. No Docker, local database service, VM, or paid infrastructure is required. This supersedes the original local-container assumption; see ADR 0005.

## Rationale

The portfolio goal needs a server-rendered data-heavy application, an integrated backend-for-frontend, and localized role-aware screens. PostgreSQL supports the aggregations and transaction behavior needed for the order/inventory/finance chain. Drizzle keeps SQL visible and typed.

## Consequences

- Domain access stays behind `server/queries` and `server/services`.
- PostgreSQL integration tests are required for locking, transactions, and aggregate behavior.
- Local and deployment configuration must not assume an Azure VM.
- Versions are pinned in the lockfile; implementation follows documentation for the chosen versions.
