# Repository guidance

- Read `IMPLEMENTATION_PLAN.md` and `spec/ERP Showcase — Product & Technical Spec.md` before making product changes.
- Implement one milestone at a time. Foundations and the order-to-payment vertical slice are verified; the current milestone remains **1: Sales + dashboard**. Next work: fill out Sales screens and URL-driven dashboard metrics/charts. Do not start broad Inventory/Finance modules or stretch features until Milestone 1 acceptance criteria pass.
- Work locally for now with native **PostgreSQL**, without Docker. Use an isolated project cluster/database; do not modify existing PostgreSQL services or databases. Keep data and local credentials ignored by Git.
- Deployment is deferred: later import the GitHub repository into **Vercel Hobby** with **Neon Free managed PostgreSQL**. No cloud provisioning or paid upgrades now. Neon runtime uses its pooled URL and migrations its direct URL; local URLs may be identical. Never seed/migrate in Vercel builds or write production data from previews/tests.
- The copilot is a placeholder only. Do not add an AI provider, model runtime, MCP server, SQL generation/execution, approvals backend, VM, or cloud resource without the owner's later explicit decision.
- UI components do not access the database directly. Use `src/server/queries` for reads and `src/server/services` for business operations.
- Enforce permissions in server queries/services. Hiding a control is not authorization.
- Business mutations, audit entries, and idempotency checks belong in the same database transaction.
- Store money as integer minor units. Keep locale formatting separate from arithmetic.
- Use URL-backed filters for shareable views. Never silently ignore a filter.
- Do not put secrets in client bundles. The public demo password is explicitly a local/public-demo credential, not a production secret.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and relevant PostgreSQL/browser verification before claiming completion. Report commands that could not run.
- Preserve user data and existing files. Do not reset or delete a database/branch without confirmation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
