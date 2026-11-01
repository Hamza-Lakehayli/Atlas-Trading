# ERP Showcase — Product & Technical Spec

*Draft v1 · October 31, 2026 · Stack: Next.js + TypeScript + PostgreSQL*

**Current owner direction:** work locally using **native PostgreSQL**, without Docker; leave existing databases/services untouched and isolate project data. Deployment comes later: normal GitHub repository → **Vercel Hobby (free tier)** + **Neon Free managed PostgreSQL**. No cloud resource, VM, or paid service is provisioned now. The copilot is a clearly labeled placeholder only; operational AI, approval workflows, and MCP are deferred until an explicit end-of-project decision. `IMPLEMENTATION_PLAN.md` defines the current milestone scope.

## 1. Overview

**Goal:** a believable, enterprise-style ERP web app whose dashboards, charts and metrics make business data easy to read and act on. It is a portfolio piece: a recruiter or hiring manager should understand its value within 3 minutes of opening the demo.

**Design principles**

1. **Data first.** The dashboard is the product. Every module feeds it, and every number on it links to the records behind it.
2. **Believable data.** A seeded dataset with trend, seasonality and a few anomalies makes charts look real. Empty charts sell nothing.
3. **Depth over breadth.** Fewer modules, each with enterprise patterns done properly (RBAC, audit trail, validation, accessibility, tests), beat many half-built screens.
4. **Demo-friendly.** One-click login per role, resettable data, no signup friction.

## 2. Framework decision: Next.js (App Router)

**Choice: Next.js with TypeScript (strict).**

Why Next.js over plain React (Vite SPA):

- **Server Components suit a data-dense, auth-gated app.** Aggregations and queries run on the server and ship little JS; chart libraries are isolated as small client components.
- **Built-in backend-for-frontend.** Server Actions and route handlers remove the need for a separate API in v1, while a typed service layer keeps the domain logic extractable later.
- **Layouts and route groups** fit an app shell with modules; **intercepting/parallel routes** give drill-down side panels and modals.
- **Streaming + Suspense** let each dashboard widget load independently with its own skeleton, which is a visible quality signal.
- **Portfolio fit.** It shows a different side of Next.js than a storefront does: auth, RBAC, dynamic data, caching strategy and invalidation instead of static pages.

**Trade-off acknowledged:** a Vite SPA would be simpler, and a dedicated backend (NestJS or FastAPI) is more classic enterprise. This spec keeps data access behind a service layer so a backend can be split out later, and lists an optional Python analytics service as a stretch.

## 3. Scope and demo company

A fictional mid-size wholesale distributor, **Atlas Trading Co.** (placeholder name):

- 3 warehouses (Casablanca, Tangier, Marrakech), \~400 SKUs in \~12 categories
- \~120 customers, \~40 suppliers
- 24 months of generated history, \~50k order lines, single currency (MAD) with locale-aware formatting

**In scope (MVP):** Dashboard, Sales, Inventory, Finance (lite), Admin. **Phase 2:** Purchasing. **Stretch:** HR (light), Insights (anomaly detection, forecast). **Out of scope:** payroll, real payment processing, multi-currency, manufacturing/BOM, real tax rules.

## 4. Modules and features

| Module | Entities | Key screens | Priority |
| --- | --- | --- | --- |
| Dashboard | (reads all modules) | Executive overview, Sales view, Inventory view, Finance view | MVP |
| Sales | Customers, quotes, sales orders, invoices | Customer list/detail, order list/detail with status timeline, quote → order conversion, invoice view | MVP |
| Inventory | Products, categories, warehouses, stock levels, movements | Product catalog, stock by warehouse, movement ledger, adjustment and transfer forms, low-stock list | MVP |
| Finance (lite) | Invoices, payments | Receivables list, AR aging, record payment, P&L-lite by month | MVP |
| Admin | Users, roles, audit log, settings | User management, role matrix, audit log viewer | MVP |
| Purchasing | Suppliers, purchase orders, receipts | PO list/detail, receive goods (creates stock movements) | Phase 2 |
| HR (light) | Employees, departments | Headcount by department, directory | Stretch |
| Insights | Derived | Anomaly flags on revenue/stock, 90-day forecast, ask-your-data panel | Stretch |

**Order workflow:** `draft → confirmed → shipped → invoiced → paid`, plus `cancelled`. Shipping creates stock movements; invoicing creates an invoice with a due date; payments close it. This chain is what makes the dashboard numbers consistent across modules.

**Cross-cutting features**

- Command palette (Ctrl/⌘ + K) for navigation and global search
- Data tables: server-side pagination, sorting, filtering, column visibility, **saved views**, CSV export, virtualized rows for large lists
- Detail pages with an activity timeline sourced from the audit log
- In-app notifications (low stock, overdue invoices, order status)
- Dark mode, responsive down to tablet, keyboard shortcuts
- i18n: French and English
- Consistent empty, loading and error states everywhere

## 5. Dashboard and visualization spec

### 5.1 Global controls

- Date range presets (7d, 30d, QTD, YTD, custom) with **compare to previous period / previous year**
- Filters: warehouse, product category, customer segment
- All filter state lives in **URL search params**, so any dashboard view is shareable and bookmarkable

### 5.2 KPI cards

Each card shows the value, delta vs comparison period (colored and with an arrow, never color alone), and a sparkline. Clicking opens the underlying filtered table.

| KPI | Definition |
| --- | --- |
| Revenue | Sum of net invoiced amount in period |
| Gross margin % | (Revenue − COGS) / Revenue |
| Orders / Avg order value | Confirmed orders in period; revenue / orders |
| Outstanding receivables | Sum of unpaid invoices, with the overdue share highlighted |
| DSO | (Receivables / Revenue) × days in period |
| Inventory value | Σ (quantity × average unit cost) |
| Low-stock SKUs | Count of products where quantity ≤ reorder point |
| On-time delivery % | Orders shipped on or before promised date / orders shipped |

### 5.3 Charts

| # | Chart | Type | Notes |
| --- | --- | --- | --- |
| 1 | Revenue over time | Area/line | Overlay of comparison period; daily/weekly/monthly granularity toggle |
| 2 | Revenue by category | Stacked bar | Monthly; legend toggles series |
| 3 | Top customers / top products | Horizontal bar | Toggle between the two, top 10 |
| 4 | Sales funnel | Funnel/bar | Quotes → orders → invoiced → paid, with conversion rates |
| 5 | Receivables aging | Bar | Buckets 0–30, 31–60, 61–90, 90+ days |
| 6 | Stock health by warehouse | Stacked bar | Healthy / low / out of stock |
| 7 | Inventory turnover by category | Bar | COGS / average inventory value |
| 8 | Orders by weekday × hour | Heatmap | Shows operational rhythm |
| 9 | Cash movement | Waterfall | Stretch |
| 10 | Revenue by city | Table with in-cell bars | Map is a stretch |

### 5.4 Interaction and quality rules

- Tooltips show exact values; axes use compact formatting (1.2M, 340k)
- **Click-through drill-down:** clicking a bar, slice or KPI navigates to a table pre-filtered to that segment
- Each widget is its own Suspense boundary with a skeleton, and its own error state with retry
- Colorblind-safe palette, consistent color per category across all charts
- Accessibility: chart `aria-label`, plus a toggle to view any chart as a data table
- Layout: 12-column grid; **stretch:** drag-and-drop widget layout (dnd-kit) persisted per user
- Widgets are permission-aware: a role without Finance access never sees finance KPIs

## 6. Data model

**Conventions:** UUID primary keys, `created_at`/`updated_at` on every table, money stored as integer minor units, `organization_id` on every business table (single org in the demo, but the schema is tenant-ready), soft delete where history matters.

| Entity | Key fields |
| --- | --- |
| organizations, users, roles | name, email, role, locale, last\_login |
| categories, products | sku, name, category\_id, unit\_cost, unit\_price, reorder\_point, active |
| warehouses | name, city |
| stock\_levels | product\_id, warehouse\_id, quantity |
| stock\_movements | product\_id, warehouse\_id, type (receipt, shipment, adjustment, transfer), quantity, reference\_type, reference\_id |
| customers | name, segment, city, credit\_limit, payment\_terms\_days |
| quotes, quote\_lines | customer\_id, status, valid\_until; product\_id, qty, price |
| sales\_orders | customer\_id, status, order\_date, promised\_date, shipped\_at, warehouse\_id |
| sales\_order\_lines | order\_id, product\_id, quantity, unit\_price, unit\_cost\_at\_sale |
| invoices | order\_id, number, issued\_at, due\_date, status, total |
| payments | invoice\_id, amount, paid\_at, method |
| suppliers, purchase\_orders, po\_lines | Phase 2 |
| audit\_log | actor\_id, action, entity\_type, entity\_id, before (jsonb), after (jsonb), at |

**Analytics layer.** Dashboard queries should not repeatedly scan raw order lines. Build SQL views and materialized views such as `mv_daily_sales` (date, category, warehouse, revenue, cogs, orders), `v_ar_aging` and `v_stock_health`; include customer/segment dimensions where the actual widgets require them. Refresh after seeding and with bounded mutation-driven maintenance or the daily maintenance pass, not frequent cron jobs. Publish a history/live cutoff and handle backdated changes without missing or double-counting records. Store fulfillment cost on order lines so historical margin does not change with today's product cost.

## 7. Architecture

**Layers (top to bottom)**

1. **UI:** Server Component pages compose widgets; chart and table interactivity lives in small client components.
2. **Entry points:** Server Actions (mutations) and route handlers (exports, SSE). Every input is validated with Zod.
3. **Services:** domain logic and authorization (`can(user, 'invoice:write')`), the only place that enforces permissions.
4. **Repositories/queries:** typed SQL via Drizzle; read-heavy analytics in `queries/`.
5. **PostgreSQL.**

**Suggested structure**

```
src/
  app/
    (auth)/login/
    (app)/
      layout.tsx            # shell: sidebar, topbar, command palette
      dashboard/
      sales/ inventory/ finance/ admin/
    api/                    # exports, SSE
  components/
    ui/                     # shadcn primitives
    charts/                 # chart wrappers (client)
    widgets/                # dashboard widgets (server + chart island)
    data-table/
  server/
    db/                     # schema, migrations, seed
    services/               # business logic + authz
    queries/                # analytics queries
    auth/                   # session, permissions
  lib/                      # formatters, date ranges, zod schemas
  messages/                 # fr.json, en.json
```

**Rules**

- Components never touch the database directly; they call `queries/` or `services/`.
- Dashboard queries are keyed by the parsed URL filters and cached with tags; mutations revalidate the affected tags so KPIs update after an action.
- Audit-log writes happen in the service layer, in the same transaction as the change.
- Live updates use short polling only while visitors are active, with hidden-tab pause/backoff and bounded payloads. No WebSockets, SSE, or always-on process in v1.

## 8. Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router), React, TypeScript strict |
| UI / styling | Tailwind CSS + shadcn/ui (Radix primitives) |
| Charts | Recharts via shadcn chart components; ECharts only for heatmap/waterfall if Recharts falls short |
| Tables | TanStack Table + TanStack Virtual |
| Forms / validation | React Hook Form + Zod |
| URL state | nuqs |
| Client data fetching | Server Components by default; TanStack Query only for polling widgets |
| Database / ORM | PostgreSQL + Drizzle (close to SQL, good for aggregations) |
| Auth | Better Auth with role support |
| i18n | next-intl (FR/EN) |
| Seeding | @faker-js/faker with a deterministic seed script (trend, seasonality, injected anomalies) |
| Testing | Vitest (services, queries), Playwright (e2e) |
| Quality | ESLint, Prettier, Husky, GitHub Actions CI |
| Hosting | Native local PostgreSQL during development; later normal GitHub repository → Vercel Hobby + Neon Free. No Docker/VM; cloud deployment deferred |
| Observability | Sentry, structured logging (pino) |
| AI / agents | Informational copilot placeholder only; no AI SDK, provider, runtime, MCP server, or approval backend in current scope |

### 8.1 Deployment and free-tier constraints

- Import the GitHub repository into Vercel using its Next.js preset, root `.`, and `npm run build`; this is not a static export and needs Node.js server functions for auth and business logic.
- Neon is separate persistent storage. Use the pooled `DATABASE_URL` at runtime and direct `DATABASE_URL_UNPOOLED` for operator-run migrations/checks. Preserve TLS; do not disable certificate verification.
- Current development runs `npm run dev` against native local PostgreSQL, in an isolated project cluster/database. No Docker; no Neon account is needed to work locally. Neon is the later deployment database.
- Keep production and development/preview data separate. If free-tier limits prevent an isolated preview database, disable database-backed preview verification rather than sharing production credentials.
- Apply reviewed migrations and initial seeds explicitly from a trusted operator environment, not during builds, startup, or visitor requests.
- Keep database pools small and manage their idle lifecycle on Vercel. Select nearby function/database regions where supported.
- Vercel Hobby cron is daily-only and may run anywhere within its scheduled hour. Combine future daily reset/maintenance behind a protected endpoint; do not assume precise midnight, minute-by-minute, or hourly jobs. Do not register unimplemented cron routes.
- Simulation ticks and maintenance batches must finish within function limits, with persisted progress where necessary. Do not run full historical seeding in a function or maintain a background worker.
- Pause polling on hidden tabs; bound retained audit/telemetry data, query work, and dataset storage. Measure storage/index/aggregate footprint and actual compute usage against current Neon/Vercel free quotas before release.
- Hobby is intended for personal, non-commercial use. Re-evaluate eligibility before commercial use. No paid upgrades, VM, Azure provisioning, or automatic spending are authorized.

## 9. Enterprise-grade checklist

**RBAC matrix** (R = read, W = write, — = no access)

| Role | Sales | Inventory | Finance | Admin |
| --- | --- | --- | --- | --- |
| Admin | RW | RW | RW | RW |
| Sales manager | RW | R | R | — |
| Warehouse | R (orders to ship) | RW | — | — |
| Accountant | R | R | RW | — |
| Viewer | R (dashboards only) | R | R | — |

**Checklist**

- [ ] Authorization enforced in the service layer, not just hidden in the UI
- [ ] Audit log for every create/update/delete/status change, with before/after diff
- [ ] Zod validation on every server entry point; typed errors surfaced as friendly messages
- [ ] Security headers and CSP, rate limiting on auth and export endpoints, no secrets in the client bundle
- [ ] Accessibility: WCAG AA contrast, keyboard navigation, focus management in modals, chart data-table fallback
- [ ] Performance budget: first dashboard widget < 1.5 s, full dashboard < 3 s on the 50k-order-line dataset; charts code-split; Lighthouse ≥ 90 for performance, accessibility and best practices
- [ ] Tests: unit tests for KPI formulas and permission checks, e2e for login per role, dashboard filter + drill-down, order-to-payment flow
- [ ] CI runs lint, type-check, unit and e2e tests on every PR
- [ ] Error boundaries and not-found pages per route group; CSV export; empty states
- [ ] ADRs (short decision records) for the major choices

## 10. Differentiators

Two active features make the demo interactive and inspectable: simulation and under-the-hood mode. They reuse the existing services and audit log. A future governed copilot is described below for context but remains a clearly labeled placeholder, not a working release feature.

### 10.1 Simulation panel

A control in the top bar advances demo time and generates business activity, so KPIs, charts and the order feed visibly change while the visitor watches.

**How it works**

- **Controls:** play/pause, speed (1 simulated day per 10 s, 30 s or 60 s), scenario picker, reset.
- **Engine** in `server/simulation/`: each tick draws events from the seeded distributions (weekday seasonality, basket size, customer mix) and calls the same services as the UI: create order, confirm, ship, invoice, pay. Rules, stock movements and audit entries are therefore real; the engine never writes to tables directly.
- **Serverless-friendly:** a tick is one server action that advances the clock by a step; there is no long-running process.
- **Live numbers:** history comes from the materialized views, and today's figures are a live delta (rows since the last refresh) added on top, so widgets update on every tick without refreshing the views.
- **Live feed:** widgets revalidate their cache tags on each tick; use bounded polling while simulation is active, pause on hidden tabs, and animate KPI value changes. No persistent stream or process.
- **Isolation (v1):** one shared demo organization, a global cap on simulated events per minute, and a manual/daily baseline restore. Simulated records carry source/run identity, but deleting only those rows cannot restore changed baseline balances. Reset must restore baseline business state under a lock, rebuild affected analytics, advance the data generation, and invalidate caches. The future daily reset follows Hobby's approximate daily schedule. Per-visitor isolation is a stretch.

**Scenarios**

| Scenario | What changes | What the visitor sees |
| --- | --- | --- |
| Normal | Baseline order rate and mix | Steady KPIs with small daily variation |
| Promo week | Order volume +40%, price cut of 10% on one category | Revenue up, margin down, stock health falling |
| Supplier delay | Receipts from one supplier stop for 10 simulated days | Low-stock SKUs rise, orders ship late, on-time delivery drops |
| Demand spike | One category at 3× demand for 3 days | Stockouts, unfulfilled orders, a shift in the weekday × hour heatmap |

**Acceptance criteria**

- [ ] Starting a scenario changes at least 4 KPIs and 3 charts within 10 s, with no page reload
- [ ] Every simulated order completes the full chain through the normal services, and the audit log shows actor `simulation`
- [ ] Pause, speed change and reset work, and reset returns the dashboard to its seeded values
- [ ] The event cap holds: repeatedly pressing play cannot exceed it

### 10.2 Governed AI copilot

> **Deferred future design — not current implementation scope.** Implement only a localized `/copilot` placeholder disclosing that no model is connected. Do not build the capabilities, tools, proposals, approvals, MCP endpoint, credentials, or runtime described below. All acceptance criteria in this subsection are deferred, not release blockers. Reconsider them after the working ERP is complete, with explicit owner approval and a cost/security review. A dedicated VM is not assumed to be necessary; compare hosting options at that time.

An assistant answers questions about the data and proposes actions, but it cannot change anything itself: every write goes through a human approval queue and the audit log.

**Capabilities**

- **Ask your data:** a question becomes read-only SQL against an allowlist of views (`v_*`, `mv_*`). The generated SQL is shown beside the answer, and the result renders as a table or chart.
- **Weekly brief:** a short summary of what changed. Queries compute every number; the model only writes the narrative around them.
- **Proposed actions:** reorder SKUs below their reorder point, follow up on overdue invoices, flag a price below the margin floor. Each becomes a *proposal*, never a change.

**Tools**

| Tool | Type | Behavior |
| --- | --- | --- |
| `query_data(sql)` | Read | Runs automatically: read-only database role, allowlisted views, single statement, row limit, statement timeout |
| `get_kpis`, `get_entity` | Read | Runs automatically, scoped to the signed-in user's permissions |
| `propose_reorder`, `propose_collection_followup`, `propose_price_change` | Write | Creates a pending proposal only |

The agent has no tool that mutates business tables. It inherits the signed-in user's role, so a Warehouse user cannot read finance data through it.

**Approval flow**

1. The copilot calls a write tool. The tool inserts a row in `agent_proposals` with the tool, arguments, rationale, supporting query and risk level, status `pending`.
2. The proposal appears in the approval queue (bell icon and an Approvals page) with a diff of what would change.
3. A user with the required permission approves, edits or rejects it, with an optional comment. Risk level decides who may approve (for example, Sales manager for low risk, Admin above an amount threshold).
4. On approval, the service layer executes the action as the approver, with the copilot recorded as proposer. On rejection nothing runs and the reason is stored. Unreviewed proposals expire after 24 hours.
5. The audit log records proposer, approver, decision, executed change and timestamps, and the copilot is told the outcome.

Statuses: `pending` → `approved` → `executed`, or `rejected`, `expired`, `failed`. Execution is idempotent, so a double click cannot run an action twice.

**MCP server**

The same tools are exposed at `/api/mcp` through an MCP server (TypeScript SDK, streamable HTTP) so external clients such as Claude or an IDE agent can use the ERP. Access uses an API token tied to a demo user and role. Read tools run directly; write tools return a proposal ID and wait for approval in the web UI. Requests are rate-limited.

**Model and safety**

- The model sits behind a provider interface (Vercel AI SDK), so it is swappable. A free-tier hosted model, such as one served through NVIDIA NIM, is enough for the demo. Suggested-question chips and cached answers keep it fast and cheap.
- Free-text fields from the database (customer notes, product descriptions) are treated as untrusted data. Because the agent cannot bypass the queue, injected text can at worst create a pending proposal that a human sees.

**Acceptance criteria**

- [ ] *Which 5 customers have the most overdue receivables?* returns a correct answer with the SQL visible
- [ ] Non-SELECT statements, tables outside the allowlist and queries over the timeout are rejected, covered by tests
- [ ] No business data changes without an approved proposal; a test asserts the tool list has no direct write path
- [ ] An approved proposal executes exactly once and shows proposer and approver in the audit log; a rejected one runs nothing
- [ ] A Warehouse-role user gets no finance data through the copilot
- [ ] An external MCP client can list the tools, and a write tool called from it creates a pending proposal

### 10.3 Under the hood mode

A topbar toggle (and keyboard shortcut) overlays every widget with how it was produced, so a reviewer sees the architecture decisions without opening the repo.

**What it shows**

- **Per widget:** query time in ms, rows returned, cache status (hit or miss, cache tag, age), data source (for example `mv_daily_sales` plus live delta), the permission that gated it (for example `finance:read`), and the SQL in a collapsible, highlighted block.
- **Per page:** a request timeline showing which widgets streamed in and when, in Suspense order.
- **Architecture page (`/architecture`):** the layer diagram from section 7, the list of decision records, and live figures: dataset size, p50 and p95 query times over recent requests, test count and CI status.

**How it works**

- A wrapper around every function in `queries/` records name, SQL, filter parameters, duration and cache status into a request-scoped store (`AsyncLocalStorage`). It is built in Phase 1, because adding it later means touching every query.
- Metadata is collected and sent to the client only when the mode is on. Only filter values are displayed, never connection strings, secrets or personal data.
- The displayed SQL comes from the same function that runs the query, not from a copy.

**Acceptance criteria**

- [ ] With the mode on, every dashboard widget shows query time, cache status and data source
- [ ] With the mode off, no instrumentation data reaches the client
- [ ] `/architecture` shows live p50 and p95 query times and links to each decision record

**Roadmap placement.** The wrapper starts in Foundations; simulation and under-the-hood UI are built in phase 4b. The copilot remains a placeholder; phase 4c is an optional post-project decision, not an implementation dependency.

## 11. Roadmap

| Phase | Deliverables | Done when |
| --- | --- | --- |
| 0. Foundations | Repo, tooling, CI, design tokens, app shell (sidebar, topbar, command palette), auth with roles, schema, migrations, seed script | Login as each role works; seeded data is visible in a basic table |
| 1. Sales + dashboard | Customers, quotes, orders, invoices; executive dashboard with KPI cards and charts 1–5; URL-driven filters; drill-down | Changing a filter updates every widget; clicking a chart segment opens the filtered table |
| 2. Inventory | Products, stock levels, movements, adjustments, low-stock alerts; inventory widgets (charts 6–7) | Shipping an order reduces stock and the KPIs move |
| 3. Finance | AR aging, payments, P&L-lite, finance widgets | Recording a payment updates receivables, DSO and aging |
| 4. Hardening | RBAC enforcement, audit log UI, saved views, CSV export, i18n, notifications, accessibility pass, e2e suite | Checklist in section 9 is green |
| 4b. Live demo features | Simulation engine and scenarios, under-the-hood mode, architecture page | Acceptance criteria in 10.1 and 10.3 pass |
| 4c. Deferred copilot decision | Placeholder only during this project; optional cost/security/hosting feasibility review after packaging | No live AI/provider/MCP/approval infrastructure; any activation requires explicit owner approval |
| 5. Packaging | Demo mode, README, screenshots/GIF, case-study page, Lighthouse report | See section 12 |
| Stretch | Purchasing, HR, Insights, drag-and-drop dashboard, map | — |

**Insights stretch (plays to a data/AI profile):** anomaly flags on daily revenue (rolling z-score or STL residuals), a 90-day forecast (Holt-Winters or Prophet-style in a small Python service). Ask-your-data now lives in the governed copilot (section 10).

## 12. Portfolio packaging

- **Demo login switcher:** one-click buttons for each role on the login page; no signup
- **Resettable data:** bounded manual/daily baseline restore so visitors cannot permanently break the demo; daily timing is approximate under Hobby, and full reseeding is an operator task, not a request/build step
- **Guided tour:** 4 short steps on first visit (filters, drill-down, command palette, role switch)
- **README:** architecture diagram, feature list, screenshots or a 60-second GIF, how to run locally, and a short **Decisions** section (why Next.js, why materialized views, why a service layer)
- **Proof points:** test count, Lighthouse scores, dataset size, all stated in the README
- **Case-study page** on the main portfolio linking to the live demo and repo, framed around the problem (making business data legible), the architecture and the trade-offs

## 13. Open decisions

1. Single-tenant schema with `organization_id` only, or add Postgres row-level security for real tenant isolation (stretch)?
2. Insights: TypeScript-only, or a small Python service for forecasting?
3. Customizable dashboard layout in v1, or fixed layout first?
4. Real map for geographic revenue, or table with bars?
5. **Resolved:** native local PostgreSQL for development now, without Docker; Neon Free and Vercel Hobby deployment from GitHub later. No VM or paid upgrade.

*Tip for building with coding agents:* keep this file in the repo as `docs/SPEC.md`, add a short `AGENTS.md` with the structure and rules from section 7, and give the agent one phase at a time with its acceptance criteria from section 11.
