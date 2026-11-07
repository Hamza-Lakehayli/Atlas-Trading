# Atlas Trading Co. — Implementation Plan

> Implementation handoff for Luna.
> Source: `spec/ERP Showcase — Product & Technical Spec.md`.
> Status: Foundations and the order-to-payment vertical slice pass local PostgreSQL, integration, browser, and accessibility checks. Customer directory/detail and quote lifecycle/conversion are implemented and verified locally. Milestone 1 continues with invoice screens and the executive dashboard; full Inventory and Finance modules follow later.

> **Current owner direction:** work locally using native PostgreSQL, without Docker. Use an isolated project cluster/database and leave existing services/data untouched. Later deploy the normal GitHub repository to Vercel Hobby (free tier), with Neon Free managed PostgreSQL. No cloud resources or paid plans now.

## 1. Goal and governing decisions

Build a believable, enterprise-style wholesale ERP portfolio application. A reviewer should understand its value within three minutes through a clear dashboard, coherent business workflows, realistic data, and inspectable architecture.

Build a transaction-safe order-to-payment vertical slice before expanding the module UIs. Permissions, audit logging, deterministic data, and query instrumentation start in Foundations, not during final hardening.

### Approved scope adjustment: copilot is a placeholder

The owner has explicitly deferred the operational copilot until the end of the project because infrastructure resources are limited and shared across projects.

For this implementation:

- Include a clearly labeled copilot placeholder in the UI.
- Do not integrate an AI provider, model runtime, Vercel AI SDK, MCP SDK/server, generated SQL execution, proposal execution engine, or approval queue.
- Do not provision a VM or any Azure resource for the copilot.
- Do not introduce background AI services, model downloads, API keys, or AI-related recurring costs.
- Do not imply that example questions or responses are live functionality.
- Reconsider activation only after the core ERP, simulation, inspection features, and portfolio packaging are complete, with explicit owner approval.
- A later feasibility review must compare hosted APIs, existing infrastructure, local execution, and a dedicated runtime; do not assume that every copilot architecture requires a VM.

The original spec's operational copilot requirements, including section 10.2 and roadmap phase 4c, are deferred and are **not release blockers**. Preserve their intent in future-work documentation, not speculative implementation.

### Other implementation defaults

| Area | Decision |
| --- | --- |
| Framework | Current stable Next.js App Router, React, strict TypeScript; pin compatible versions and commit the lockfile. No canary dependencies. |
| Database | Native local PostgreSQL through Drizzle for development; Neon Free for deployment later. Local runtime/migration URLs may match; Neon uses pooled runtime/direct migration URLs. No Docker. |
| Tenancy | One shared demo organization; organization-scoped services, queries, constraints, and cache keys. Do not claim full tenant isolation without RLS. |
| Authorization | One permission definition shared by services, UI, widgets, search, and exports; services enforce access. |
| Layout | Fixed responsive dashboard; drag-and-drop is deferred. |
| Geography | City table with in-cell bars; no map initially. |
| Live updates | Short polling while simulation runs or notifications are active; no SSE initially. |
| Analytics | Separate data sources for invoiced sales, orders, receivables, and inventory. |
| Simulation | Persisted business clock, distributed locking, idempotent ticks, global event limits, reliable baseline restore. |
| Finance | Receivables, payments, revenue, COGS, and gross profit. Do not label a report as a complete P&L without expenses. |
| AI | Clearly labeled placeholder only; revisit after release readiness. |
| Hosting | GitHub repository imported into Vercel Hobby; Neon Free persistence. No paid upgrades or automatic provisioning. |

Purchasing, HR, forecasting, maps, custom dashboard layouts, and Python services are not prerequisites for release.

## 2. Business contracts to document first

Create `docs/METRICS.md`, `docs/WORKFLOWS.md`, and short ADRs before implementing domain queries. These documents must state the actual rules used by services and tests.

### 2.1 Money, quantities, and time

- Store money in integer MAD minor units.
- Use exact arithmetic for prices, discounts, allocations, and costs; define and test one rounding policy.
- Start with whole-number stock quantities unless fractional units are explicitly approved.
- Store event timestamps in UTC; interpret business dates using `Africa/Casablanca`, not a fixed UTC offset.
- Use half-open timestamp ranges: `[start, end)`.
- Inject a business clock into services and analytics so normal pages and simulation use the same definition of today.
- Reject invalid dates, negative prices, nonpositive line quantities, and invalid payment amounts.
- Format money, quantities, and dates by locale without changing business calculation semantics.

### 2.2 Order lifecycle

Implement explicit operations, not an unrestricted status setter:

```text
create draft → confirm → ship → issue invoice → record payment → paid
                    ↘ cancel
```

- Draft orders are editable.
- Confirmation validates customer, lines, pricing, warehouse, and permissions.
- Shipping checks and reduces stock atomically.
- MVP fulfillment is all-or-nothing; partial shipping is deferred.
- Invoicing requires a shipped order; MVP allows one invoice per order.
- Partial payments are supported; settlement occurs only when outstanding balance reaches zero.
- Draft and confirmed orders may be cancelled.
- Shipped/invoiced orders cannot simply be cancelled. Returns, refunds, and credit notes are out of scope.
- Repeated quote conversion, shipping, invoicing, or payment requests cannot duplicate business effects.
- Persist `confirmed_at`, `shipped_at`, `invoiced_at`, and `paid_at` so analytics do not infer history from current status.

### 2.3 Inventory costing

- Maintain moving weighted-average cost per product/warehouse.
- Capture fulfillment cost when shipping and freeze the cost used for invoiced margin reporting.
- Never recompute historical COGS using the product's current cost.
- Transfers preserve carried inventory value.
- Negative stock is prohibited.
- Document the capture point for the spec's `unit_cost_at_sale`; use fulfillment cost in this MVP.
- Historical valuation requires movements with sufficient cost information and/or daily snapshots.

### 2.4 Metric definitions

| Metric | Implementation contract |
| --- | --- |
| Revenue | Net issued invoice amount within the selected period. |
| Gross margin | `(revenue - invoiced COGS) / revenue`; unavailable if revenue is zero. |
| Orders | Orders confirmed in the period using `confirmed_at`. |
| AOV | Prefer net invoiced revenue / distinct invoiced orders in the same period. Record this deliberate improvement over the spec's mixed-cohort formula in `docs/METRICS.md`. |
| Receivables | Invoice balances as of period end; exclude payments made after that boundary. |
| DSO | Period-end receivables / period revenue × period days; label as a simplified estimate; unavailable for zero revenue. |
| Inventory value | Quantity × carried average cost as of the selected date. |
| Low stock | Evaluate product/warehouse balance against its warehouse-specific reorder point; distinguish SKU count from SKU-location count. |
| On-time delivery | Orders shipped on/before promised date / orders shipped in the selected period. |
| Turnover | Period COGS / average inventory value, using daily snapshots where available. |

Additional rules:

- AR aging includes a separate `not yet due` bucket; overdue buckets must not include future-due invoices.
- Use nonoverlapping overdue buckets such as 1–30, 31–60, 61–90, and 91+ days.
- Funnel conversion uses a consistent quote cohort, not unrelated event counts from different periods.
- Missing prior-year history produces an insufficient-data state rather than an invented comparison.
- Zero-denominator comparisons show unavailable/new states, not infinity.
- Dashboard cards, reports, exports, and drill-downs use the same metric definitions.

### 2.5 Filter applicability

Create a metric-to-filter matrix in `docs/METRICS.md`.

- Sales metrics support warehouse, product category, and customer segment where their source data permits.
- Customer segment does not meaningfully filter warehouse inventory without an allocation model.
- Category-filtered receivables require allocation of invoice balances to lines; do not silently invent this behavior.
- Disable or visibly label unsupported filters for affected widgets.
- Do not silently ignore filters while implying every widget is synchronized.
- Separate event-period metrics from as-of snapshot metrics in labels and help text.

## 3. Architecture and project structure

Use the spec's layered architecture. Server Components compose pages; client islands handle forms, charts, and table interactions. Components do not access the database directly.

```text
src/
  app/
    [locale]/
      (auth)/login/
      (app)/
        dashboard/
        sales/
        inventory/
        finance/
        admin/
        copilot/
        architecture/
    api/
      auth/
      exports/
      notifications/
      simulation/
      internal/
  components/
    ui/
    shell/
    charts/
    widgets/
    data-table/
    forms/
  server/
    auth/
    db/
      schema/
      migrations/
      seed/
    repositories/
    services/
    queries/
    analytics/
    observability/
    simulation/
  lib/
    dates/
    money/
    filters/
    validation/
  messages/
docs/
  adr/
tests/
  unit/
  integration/
  e2e/
```

The locale prefix is omitted from route examples below for readability. The copilot route is a static placeholder; no copilot backend directories or endpoints are needed now.

### 3.1 Service execution context

Every business operation receives a trusted server-created context:

- Actor and organization.
- Current permissions.
- Request/correlation ID.
- Business clock.
- Source: human, simulation, or seed.
- Optional idempotency key.

Every mutation follows this sequence:

1. Validate input with Zod.
2. Check permissions and organization ownership.
3. Check business preconditions.
4. Write business changes and audit records in one transaction.
5. Commit.
6. Invalidate affected caches.

Services must support transaction composition so simulation can reuse them without creating unrelated transactions. Transactions must remain bounded; external network calls do not belong inside database transactions.

Use typed domain errors:

```text
VALIDATION_ERROR
FORBIDDEN
NOT_FOUND
CONFLICT
INSUFFICIENT_STOCK
INVALID_TRANSITION
RATE_LIMITED
```

Never expose raw database errors to clients.

### 3.2 Authorization and caching

- Authenticate and authorize reads as well as writes.
- Do not trust organization IDs, actor IDs, or roles supplied by a client.
- Keep session/cookie access outside shared cached functions.
- Cache keys include organization, normalized filters, data generation, and relevant permission scope.
- Invalidate domain tags after committed changes; use an appropriate fresh-read strategy for the acting user.
- Role changes and resets must not leave accessible stale privileged data.
- Use supported caching APIs for the pinned Next.js version; verify behavior in a running application.

## 4. Schema and deterministic dataset

### 4.1 Schema

Implement the spec's core entities plus required supporting structures:

- Better Auth users, sessions, accounts, and verification tables.
- Organization membership and role assignments.
- Quote/order/invoice transition timestamps.
- Immutable invoice lines or invoice snapshots.
- Per-warehouse reorder settings and inventory costing.
- Paired stock-transfer references.
- Daily inventory snapshots for historical metrics.
- Saved views.
- Notifications and read state.
- Idempotency records.
- Simulation state, runs, and scheduled events, introduced with simulation.
- Aggregate-refresh/cutoff metadata.

Do not build agent proposals, MCP token tables, AI conversation storage, or approval infrastructure for a placeholder.

### 4.2 Constraints and indexes

At minimum:

- Organization-scoped unique SKUs and document numbers.
- Unique product/warehouse stock balances.
- Positive order quantities and payment amounts.
- Unique invoice-per-order constraint.
- Scoped idempotency-key uniqueness.
- Organization-consistent relationships, including cross-entity foreign keys where practical.
- Indexes for order date/status/warehouse, invoice due date/outstanding state, customer/category drill-downs, movement product/warehouse/date, and audit entity/date.
- Row locks or atomic conditional updates for stock and payment races.

A disabled button is not concurrency protection.

### 4.3 Seed generator

Support configurable seed, anchor date, and dataset scale:

- Small fixtures for tests.
- Full portfolio dataset: approximately 400 SKUs, 12 categories, 120 customers, 40 suppliers, three warehouses, 24 months, and 50,000 order lines.
- Reproducible identities and baseline totals.
- Growth, seasonality, weekday rhythms, customer concentration, and injected anomalies.
- Overdue invoices, late shipments, low stock, and multiple lifecycle states.

Generate coherent event histories, not independently randomized tables. Include opening inventory and receipts before shipments. Baseline seeding may use validated bulk insertion; simulation must use normal services. Both paths must satisfy the same invariants.

Seed validation proves:

- Invoice totals match lines.
- Payments never exceed invoice totals.
- Stock balances reconcile with movements.
- Historical stock never becomes negative.
- Lifecycle timestamps and statuses agree.
- Dashboard totals match independently computed reference totals.

**Exit criterion:** a fresh database migrates, seeds, validates, and reproduces the same baseline.

## 5. Milestone 0 — Foundations

### Work

1. Initialize the application, package manager, lockfile, and compatible dependency versions.
2. Configure strict TypeScript, ESLint, Prettier, environment validation, and CI.
3. Configure native local PostgreSQL, Drizzle migrations, seed commands, and container-free local setup. Keep local data and credentials ignored by Git. Retain Neon-compatible connections for later deployment; do not provision cloud resources now.
4. Integrate Better Auth and demo-role login.
5. Define granular permissions and their mapping to the five roles.
6. Build sidebar, topbar, breadcrumbs, theme toggle, locale switcher, and command-palette navigation.
7. Add shared loading, empty, error, and not-found components.
8. Establish structured logging and the query instrumentation wrapper.
9. Establish FR/EN message files from the start.
10. Add a clearly labeled copilot placeholder route and navigation entry.

### Permission details

Use permissions such as:

```text
dashboard:sales:read
dashboard:finance:read
orders:read
orders:write
orders:ship
inventory:read
inventory:adjust
inventory:transfer
invoices:read
payments:record
users:manage
audit:read
simulation:control
```

- Warehouse users may ship permitted orders without broad Sales-edit permissions.
- Warehouse responses omit financial fields entirely, including hidden columns and serialized payloads.
- Viewer access must reflect dashboard-only Sales access from the spec, not unrestricted entity reads.
- Public demo Admin has no infrastructure access or unrestricted authentication administration.
- Protect canonical demo accounts from deletion, credential changes, and role changes.

### Copilot placeholder

- Route: `/copilot`.
- Label: `Copilot — planned` or equivalent localized copy.
- Explain that the feature is intentionally deferred and not active.
- Show proposed future capabilities as descriptions only.
- No active chat input, fake answers, SQL runner, approval actions, provider configuration, or network requests to AI services.
- Do not add nonfunctional notification badges or an Approvals route.

### Acceptance

- All five roles can log in through the demo flow.
- Unauthorized direct service/action calls fail.
- A seeded table is visible.
- FR/EN routes and theme switching work.
- Fresh migration and seed validation run in CI.
- The first queries use instrumentation.
- Placeholder works with no AI credentials or runtime.

## 6. Milestone 1 — Vertical slice, Sales, and dashboard

### 6.1 First working vertical slice

Implement minimal services and basic UI for:

```text
create order → confirm → ship → invoice → partial payment → final payment
```

This requires shipping and payment services before their full Inventory and Finance UIs. **Verified locally** with native PostgreSQL, all five roles, browser submissions, and `npm run verify:orders`.

Implementation includes editable drafts, per-step permissions, audit writes, request idempotency, stock movements and fulfillment cost snapshots, partial settlement, and localized order list/detail screens.

Prove that:

- Shipping changes stock exactly once.
- Invoicing changes recognized demo revenue.
- Payments change receivables.
- Every operation produces an audit entry.
- Failed operations roll back all associated effects.
- Concurrent duplicate submissions produce one effect; reusing a key with a different payload conflicts.
- Warehouse users can ship but receive no prices, invoice totals, payments, or finance fields.
- PostgreSQL integration coverage checks the lifecycle, draft edits, cancellation, stock rollback, payment overage, and final settlement.

Do this before investing in a large polished dashboard.

Current vertical-slice routes are `/sales/orders` and `/sales/orders/[id]`. The form creates/edits one line at a time; the service accepts a bounded set of lines. Multiple-line UI, server-side table filters/pagination, quotes, customer details, invoice module screens, and dashboard charts remain for the rest of Milestone 1.

### 6.2 Sales screens

```text
/sales/customers
/sales/customers/[id]
/sales/quotes
/sales/quotes/[id]
/sales/orders
/sales/orders/[id]
/sales/invoices
/sales/invoices/[id]
```

Implement server-side search/filter/sort/pagination, validated forms, quote conversion, status timelines, invoice views, immutable commercial snapshots, and permission-aware actions.

Begin with normal detail pages. Intercepted side panels are optional polish only after direct URLs, refresh, and browser Back work correctly.

### 6.3 Analytics

Build independent query sources for:

- Invoiced revenue and COGS.
- Confirmed orders.
- Quote cohort conversion.
- AR aging.
- Current and historical inventory.

Choose aggregate dimensions from actual widget requirements. Customer/segment drill-downs need supporting dimensions; the spec's illustrative daily sales aggregate is not sufficient for every chart.

Do not sum category-level distinct order counts to calculate overall distinct orders.

### 6.4 Dashboard

Use one validated filter contract for server parsing, client URL updates, saved views, exports, and drill-downs:

```text
from, to, compare, warehouse, category, segment, granularity
```

Reject malformed values and limit expensive date ranges.

Implement:

- Executive overview plus Sales/Inventory/Finance views as appropriate permissions and queries become available.
- KPI cards with exact tooltips, sparklines, direction icons, and comparisons.
- Charts 1–5: revenue trend, category revenue, top customers/products, sales funnel, and AR aging.
- URL-based state and shareable views.
- Per-widget Suspense skeletons and error/retry behavior.
- Chart-to-table alternatives and consistent category colors.
- Drill-down links that preserve meaningful filters.

Keep the executive overview focused: a few primary KPIs and charts above the fold; specialist views hold the full chart collection.

### Acceptance

- Applicable widgets respond consistently to filters.
- Copied URLs reproduce the same view.
- KPI/chart totals reconcile with drill-down records.
- Full lifecycle tests pass against PostgreSQL.
- Unauthorized financial fields never reach Warehouse users.
- Every dashboard query uses the query wrapper.

## 7. Milestone 2 — Inventory

### Routes

```text
/inventory/products
/inventory/products/[id]
/inventory/stock
/inventory/movements
/inventory/low-stock
```

### Work

- Product and category management.
- Warehouse balances and reorder thresholds.
- Movement ledger.
- Adjustments requiring a reason.
- Atomic warehouse transfers.
- Low-stock alerts.
- Stock-health and inventory-turnover charts (6–7).
- Historical inventory valuation.

### Transaction rules

- Lock affected stock rows in a consistent order.
- Transfers create matched outgoing/incoming movements.
- Failed transfers change neither warehouse.
- Shipping validates stock within its transaction.
- Current cost edits cannot alter historical margins.

### Acceptance

- Concurrent shipments cannot oversell.
- Failed shipping produces no partial stock/audit effects.
- Transfers preserve total quantity and carried value.
- Low-stock widgets reconcile with stock tables.
- Historical values remain correct after cost changes.

## 8. Milestone 3 — Finance and remaining analytics

### Routes

```text
/finance/receivables
/finance/invoices/[id]
/finance/payments
/finance/reports
```

### Work

- Outstanding and overdue lists.
- Partial/full payment entry and history.
- AR aging and simplified DSO.
- Revenue, COGS, and gross-profit monthly report.
- Customer receivable summaries.
- Orders-by-weekday/hour heatmap (chart 8).
- Revenue-by-city table with in-cell bars (chart 10).

Cash waterfall (chart 9) remains stretch work. Use the existing chart stack or a lightweight custom grid for the heatmap before introducing a second large charting library.

### Payment transaction

1. Lock invoice.
2. Recalculate outstanding balance.
3. Validate amount, permission, and idempotency.
4. Insert payment.
5. Update invoice/order settlement state when appropriate.
6. Append audit record.

Reject overpayments; a customer credit-balance model is outside MVP.

### Acceptance

- Partial payments reduce balance without closing the invoice.
- Final settlement occurs once.
- Concurrent payments cannot overpay.
- As-of receivables exclude later payments.
- Aging totals match receivables.
- Finance exports enforce the same access rules as pages.
- Heatmap and city view drill-downs reconcile with records.

## 9. Milestone 4 — Enterprise completion and hardening

Authorization, audit writes, and validation already exist. This milestone completes their coverage and presentation rather than introducing them late.

### Shared table framework

- Server pagination, sorting, and filtering.
- Stable sorting with ID tie-breakers.
- Column visibility.
- Saved views scoped to user, organization, and table.
- CSV export using the same validated filters and permissions.
- CSV formula-injection protection.
- Row virtualization only when actual rendered row counts justify it.

### Admin routes

```text
/admin/users
/admin/roles
/admin/audit
/admin/settings
```

Include demo-safe user management, role matrix, audit filtering/detail, and supported organization settings. Preserve canonical accounts.

### Cross-cutting work

- Permission-filtered global search in the command palette.
- Notification generation, deduplication, read state, and pagination.
- Complete FR/EN translations.
- Keyboard navigation, focus management, contrast, chart alternatives, and tablet layouts.
- Security headers/CSP and secrets review.
- Distributed/shared rate limits for public auth, exports, and simulation.
- Sentry and structured logging with redaction.
- Error boundaries and useful recovery paths.
- Dependency and secret checks in CI.

### Acceptance

- The spec's enterprise checklist passes, excluding explicitly deferred AI functionality.
- No access bypass via CSV, search, hidden columns, HTML, RSC payloads, or JSON endpoints.
- Saved views handle removed/renamed columns safely.
- Accessibility and core E2E suites pass.

## 10. Milestone 4b — Simulation and under-the-hood mode

### 10.1 Simulation state and tick execution

Persist business clock, scenario, run ID, tick sequence, speed, lock/lease, event budget, and future events.

Each tick:

1. Authenticates and validates input.
2. Acquires the organization's simulation lock.
3. Checks tick idempotency and global limits.
4. Advances the business clock.
5. Processes a bounded batch of scheduled/generated events.
6. Calls normal business services.
7. Persists resulting state.
8. Invalidates affected caches after committed changes.

The browser requests ticks but does not own authoritative state. Handle retries and partially completed batches through persisted event identity/progress; do not depend on a long-running process.

Schedule realistic transitions: an order may be confirmed now, shipped later, and paid according to terms. Stock-blocked orders remain blocked; do not force every order through the entire chain immediately.

### 10.2 Scenarios

- Normal: baseline mix and timing.
- Promo week: +40% volume, discount on one category, margin pressure.
- Supplier delay: suppress planned receipts for one supplier for ten simulated days.
- Demand spike: category demand at 3× for three days.

Supplier delay needs replenishment without Purchasing. Implement a minimal internal receipt schedule using the stock-receipt service; no purchase-order UI is required.

Test expected effects with deterministic scenario seeds. Simulation should produce coherent business outcomes, not merely animated random numbers.

### 10.3 Polling and UX

- Controls: play/pause, scenario, speed, reset.
- Show current business date, active scenario, and shared-demo status.
- Poll lightweight change/version state and refresh affected widgets while running.
- Animate KPI value changes without hiding exact amounts.
- Stop unnecessary polling in paused/hidden states where appropriate.
- Show contention/reset messages if another visitor controls shared state.

### 10.4 Reliable reset

Deleting only `source = simulation` rows cannot restore baseline stock and other modified records.

Implement a locked baseline restore that:

- Stops ticks and blocks conflicting writes.
- Restores seeded business state, including changed balances and entities.
- Removes transient demo changes and pending scheduled work.
- Resets business clock and simulation state.
- Rebuilds analytics/snapshots as necessary.
- Advances dataset generation/version.
- Invalidates caches.

Use the same mechanism for manual and daily resets. A future Vercel Hobby daily cron may call one protected maintenance endpoint; its execution time is approximate within the scheduled hour, not an exact local-midnight guarantee. Preserve operational reset records outside the resettable business dataset. Define recovery behavior if restore fails; do not leave a half-restored dataset available for writes. Bound/reset in resumable steps if necessary to fit function limits; do not run the full seed generator in a request.

### 10.5 Analytics freshness

Do not implement an undefined “today's rows” delta.

- Publish a documented aggregate cutoff `T`.
- Historical aggregates cover data before `T`.
- Live queries cover data at/after `T`.
- Late/backdated changes before `T` invalidate affected history or trigger refresh.
- Coordinate aggregate refresh and cutoff publication.
- Do not assume minute/hourly cron refreshes on Hobby. Use bounded mutation-driven invalidation/refresh, the daily maintenance pass, and explicit freshness metadata. Never launch an always-on worker.
- Test no missing/double-counted amounts across refresh boundaries.

### 10.6 Inspection metadata

The wrapper created in Foundations records query identity, executed SQL template, sanitized parameters, duration, rows, source, cutoff, permission gate, and genuinely observable cache metadata.

- Use request-local storage for request correlation.
- Use durable/bounded telemetry for cross-request p50/p95; serverless process memory is not a metrics database.
- Do not invent cache-hit labels if the caching API cannot expose them reliably.
- Send inspection metadata only when the mode is enabled and permitted.
- Show SQL from the actual executing query, never a separately maintained copy.
- Redact secrets, connection strings, credentials, and sensitive field values.

Build `/architecture` with layer diagram, ADR links, dataset size, recent query percentiles, build-time test-count artifact, and last-known CI status with timestamp. Label unavailable/stale data honestly.

Show widget completion timings accurately; do not claim server timing is an exact measurement of browser paint/stream order.

### Acceptance

- Defined default scenario changes at least four KPIs and three charts within ten seconds without page reload.
- Pause, speed, scenario selection, and reset work.
- Concurrent/retried ticks do not duplicate events.
- Global caps apply across tabs and server instances.
- Reset exactly reproduces baseline totals.
- Daily/manual reset cannot race a tick or another mutation.
- Inspection data is absent from ordinary responses.
- Inspection obeys the same role restrictions as the data itself.
- Architecture figures are measured and timestamped, not hard-coded marketing values.

## 11. Milestone 5 — Packaging and deployment

### Deployment

- Store the app in a normal GitHub repository and import it into Vercel with the Next.js preset, root directory `.`, and build command `npm run build`.
- When deployment is requested, use Vercel Hobby and Neon Free managed PostgreSQL. Current development uses native local PostgreSQL. No Dockerfile, Compose file, VM, paid queue, or paid upgrade is required.
- Use Node.js functions with a small connection pool and Vercel pool lifecycle management. Preserve verified TLS for the managed database. Keep Vercel and Neon regions close where free-tier region settings permit.
- Configure `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET`, exact `BETTER_AUTH_URL`, explicit `DEMO_MODE`, and the documented public demo settings in Vercel environment variables. Keep the direct migration URL in the operator/controlled migration environment, not browser code.
- Run `npm run db:check`, then reviewed migrations and initial seeding against the intended managed database from a trusted local/operator environment. Never migrate or seed during Vercel builds, preview builds, startup, or page requests.
- Use distinct managed development/preview data, respecting Neon Free branch/storage limits. If no isolated preview database is available, leave previews unconfigured rather than connecting them to production.
- Future maintenance may use a protected once-daily Hobby cron, with `CRON_SECRET` and approximate hourly precision. No subdaily cron or persistent process. Do not register cron routes before they exist.
- Batch simulation and maintenance work; checkpoint long operations. Poll only while users are active and pause on hidden tabs to preserve free quotas and database scale-to-zero.
- Keep logs, audit history, and telemetry bounded so the dataset plus indexes/aggregates stays within the provider's free storage/compute allowance; verify actual plan limits before release. Do not claim free capacity is unlimited or guarantee warm-start performance.
- Add deployment smoke tests and document recovery/backup procedure.
- Record service limits and expected costs before enabling paid features.
- No Azure resource creation is part of this plan.
- The project is a personal, non-commercial showcase; recheck Hobby eligibility before commercial use. Budget exhaustion must not trigger a paid upgrade automatically.

### Portfolio UX

- One-click role login/switching.
- Four-step guided tour: filters, drill-down, command palette, role switch.
- Clear demo-data badge, current business date, and shared-reset notice.
- Suggested three-minute path: executive dashboard → segment drill-down → simulation → inspect widget.
- Copilot placeholder is honest and unobtrusive; it is not part of the working-feature demo path.

### Documentation

- Local setup and environment variable reference, without secrets.
- Architecture/data model diagrams.
- Metric definitions and permission matrix.
- Seed/reset commands and troubleshooting.
- ADRs and known limitations.
- Screenshots and a short demo GIF.
- Timestamped performance/Lighthouse evidence and test counts.
- `docs/FUTURE_COPILOT.md` describing deferred scope and activation decision criteria, without implementation.

### Release gate

A new reviewer can understand the product in three minutes, complete the main demo without help, and cannot permanently corrupt the shared dataset. No operational AI feature is required for release.

## 12. Test and performance strategy

### Unit tests

- Money, rounding, and exact arithmetic.
- Date boundaries, Casablanca timezone behavior, and comparisons.
- KPI formulas and missing-data cases.
- Permission matrix.
- State transitions.
- Filter parsing/serialization.
- Deterministic generation and scenario choices.

### PostgreSQL integration tests

Use real PostgreSQL, not SQLite, for:

Use an isolated native local development/test database now; a managed test branch may be used later. Never target production. Public PR CI runs without database secrets; database integration tests run only in a trusted, separately configured job. No container services are needed in GitHub Actions.

- Transaction rollback and audit atomicity.
- Concurrent stock/payment operations.
- Idempotency.
- Aggregate reconciliation and distinct counts.
- Historical/as-of calculations.
- Refresh cutoff boundaries.
- Reset correctness and locking.
- Permission/organization scope on reads and writes.

### Playwright E2E

1. Login and access restrictions for every role.
2. Dashboard filter URL and drill-down.
3. Quote-to-payment journey.
4. Insufficient stock handling.
5. Transfer and adjustment.
6. Partial payment and settlement.
7. Saved views and exports.
8. FR/EN, keyboard use, theme, and tablet layout.
9. Simulation, pause, scenario change, and reset.
10. Copilot placeholder makes no AI requests and clearly indicates unavailable functionality.

### CI

Run lint, type checking, unit/integration tests, migration/seed validation, production build, and core E2E tests on PRs. Keep benchmark/smoke jobs separate where cost or external service availability makes them unsuitable for every PR.

### Performance

Measure a production build with the full dataset. Document device/network assumptions, hosting/database regions, and cold versus warm behavior.

Targets from the spec:

- First meaningful dashboard widget under 1.5 seconds.
- Full dashboard under 3 seconds.
- Lighthouse performance, accessibility, and best practices at least 90 under a documented reproducible setup.

Also record query p50/p95 and client bundle size. Inspect query plans before adding caches. Code-split heavy charts; avoid a second charting library unless measurements and requirements justify it.

## 13. Deferred copilot decision — after project completion

At the end of the working project, ask the owner whether to activate the copilot. Do not treat future-work documentation as authorization.

The feasibility review should include:

- Concrete user value beyond existing filters and reports.
- Typed analytics tools first versus arbitrary SQL generation.
- Hosted inference/API versus existing runtime versus dedicated VM.
- Monthly cost, credit expiry, idle cost, and spending caps across the owner's projects.
- Rate limits, failure modes, monitoring, and shutdown controls.
- Whether MCP is actually required by the target demo clients.

If later approved, preserve the original safety goals:

- Read tools inherit verified user permissions and tenant scope.
- Model output never directly mutates business tables.
- Writes become human-reviewed proposals with reauthorization, expiry, stale-data checks, and exactly-once execution.
- Typed analytics tools are preferred initially; free-form SQL requires a separate security design with database-enforced restrictions, AST validation, limits, and tests.
- Prompt injection can still leak data or produce misleading answers even without write tools; an approval queue alone is not a complete defense.
- In-app and external tools share services and governance rather than creating alternate business paths.

No operational AI schema, infrastructure, dependencies, or endpoints need to be built until this decision is made.

## 14. Instructions for Luna

### Execution order

```text
Foundations
  → transaction-safe vertical slice
  → Sales + dashboard
  → Inventory
  → Finance + remaining analytics
  → enterprise completion
  → simulation + inspection
  → packaging and deployment
  → optional owner-approved copilot feasibility decision
```

Work one bounded milestone at a time. Do not implement the entire plan in one change set.

For every milestone, report:

1. Working behavior and affected routes.
2. Schema/migration changes.
3. Tests added and commands actually run.
4. Evidence for acceptance criteria.
5. Deviations, blockers, and limitations.
6. The next bounded milestone.

Do not replace real dashboard queries with hard-coded numbers. Mocks are permitted for isolated component development, not as shipped business behavior. Never report a test as passed unless it was run.

Consult current documentation for the pinned framework/library versions, follow applicable repository instructions, and verify browser behavior in the running application rather than relying only on type checking.

### Completed first task: Foundations

> Completed: local PostgreSQL setup, role login, bilingual shell, seeded catalogue, query instrumentation, and copilot placeholder.

### Current checkpoint: quote lifecycle and conversion

> Completed locally: Admin/Sales Manager quote list and detail routes, validated search/status/pagination, editable drafts, date-bound send/accept/reject lifecycle, immutable price snapshots, transactional idempotent conversion into a draft order, audit history, and FR/EN copy. Migration `0006_cooing_the_spike` adds quotes/quote lines and the order source reference. Next bounded task: invoice list/detail screens using the existing invoice and payment data. Continue Milestone 1 only; do not begin full Inventory/Finance modules, simulation, or AI. Before pushing, run unit tests, PostgreSQL integration, browser behavior, accessibility, and production build locally.
