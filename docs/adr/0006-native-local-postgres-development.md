# ADR 0006: Native PostgreSQL for local development

- **Status:** Accepted, explicit owner direction
- **Supersedes:** ADR 0005's managed-only development requirement; deployment remains Vercel Hobby + Neon Free later.

## Decision

Work locally with native PostgreSQL and no Docker. Use the installed PostgreSQL binaries to initialize a project-owned cluster under ignored `.local/postgres`, listen only on `127.0.0.1:5433`, and authenticate with SCRAM using generated local credentials. The system PostgreSQL service on port 5432 and all its databases remain untouched.

`npm run db:local:start` creates the project database if absent and saves its URLs privately in `.env.development.local`. `npm run db:local:stop` stops only this cluster and preserves data. Runtime and migration URLs may be identical locally. Do not commit local files or credentials.

No Neon credentials, cloud resources, VM, or deployment are required now. Use Neon pooled/direct URLs with TLS only when preparing the later Vercel deployment. Full seeding and migrations remain explicit operator commands, not build hooks or web requests.
