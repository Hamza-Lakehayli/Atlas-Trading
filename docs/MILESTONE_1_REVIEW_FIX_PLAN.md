# Milestone 1 review fixes — implementation record

## Goal and current status

> **Status: Implemented and verified locally (2026-11-09).** All six findings below have regression tests, the targeted regressions were reproduced by mutation and the fixes restored, and the local PostgreSQL/browser release gate passed. Changes remain uncommitted and unpushed.

The earlier completion claim was premature: native blank form controls, top-revenue ordering, customer drill-down dimensions, category-line reconciliation, funnel-stage destinations, and DSO scope needed fixes. The final work adds coverage for each of those cases.

Read repository `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `spec/ERP Showcase — Product & Technical Spec.md`, and `docs/METRICS.md` first. Preserve the existing working tree; it contains the implementation being fixed. Do not reset, discard, or overwrite it wholesale.

## Constraints

- Stay within Milestone 1 Sales/dashboard fixes. No Inventory/Finance expansion, AI, simulation, cloud provisioning, or deployment setup.
- Use the isolated native local PostgreSQL database. Preserve existing data; use temporary test fixtures and scoped cleanup.
- Keep database reads in `src/server/queries`, mutations in `src/server/services`, and enforce permissions there.
- Money remains integer minor units. Use `Africa/Casablanca` business dates and half-open timestamp ranges.
- Do not weaken validation, grant new role permissions, hide discrepancies with formatting, or replace real values with placeholders.
- Consult the installed Next.js guides before framework changes and current library documentation as required by repository guidance.
- Do not commit/push until the fixes and verification are complete and the owner's authorization is clear.

## Recommended execution order

For each issue, add a failing regression test, implement the smallest consistent fix, then run its targeted tests. Work through items 1–6 in order. Coordinate items 3–5 around a shared, explicit drill-down contract rather than duplicating URL construction rules.

### 1. High: normalize blank optional Sales filters

**Problem:** GET forms serialize blank controls as `""`. Optional schema fields accept `undefined`, not empty strings. Ordinary search/filter submissions therefore fail validation.

**Files:**

- `src/lib/orders/filters.ts`
- `src/lib/invoices/filters.ts`
- `src/lib/quotes/filters.ts`
- Their list-page GET forms under `src/app/[locale]/(app)/sales/`

**Implementation:**

1. Normalize empty optional form values to `undefined` at the filter parsing boundary, using a small shared helper if appropriate.
2. Cover optional dates, dimension IDs, and segment selections where the UI uses an empty value for “All”.
3. Continue rejecting malformed nonempty dates/UUIDs/enums, repeated parameters, unknown filters, reversed ranges, excessive ranges, and incomplete date pairs.
4. Preserve existing defaults and supported error-message parameters. Do not indiscriminately remove unknown parameters.

**Regression tests:**

- Orders: search/status submission with `from=""`, `to=""`, `categoryId=""`, and `segment=""` succeeds.
- Invoices: search/status/sort submission with blank issue dates succeeds; clearing optional `asOf` also works.
- Quotes: search/status submission with blank created-date controls succeeds.
- One nonempty range date plus one blank date fails; invalid nonempty filters and arrays still fail.
- In the browser, submit the actual GET forms, not only hand-built valid URLs. Verify “All” and clearing dates work.

### 2. High: sort top revenue numerically

**Problem:** `revenueAmount()` returns `sum(...)::text` and is reused for descending ordering. PostgreSQL sorts it lexically (`900` before `1000`). `LIMIT 10` can exclude the true top earners.

**File:** `src/server/queries/dashboard.ts` — `revenueAmount()`, `topRevenueByCustomer()`, and `topRevenueByProduct()`.

**Implementation:**

1. Keep the aggregate numeric for ordering.
2. Convert only the selected transport value to text if needed for exact PostgreSQL/JavaScript conversion.
3. Preserve deterministic secondary ordering and safe-integer checks.

**Regression tests:**

- PostgreSQL fixtures with totals such as 900, 1,000, 9,000, and 10,000 minor units rank numerically for both customers and products.
- Include more than ten groups to verify membership of the top ten, not just order within a short list.
- Verify ties are stable and organization/dimension/date filters remain enforced.

### 3. High: correct Top Customers drill-down URLs

**Problem:** The widget checks `"customerId" in row`, but customer rows contain `id`, `name`, and `revenueMinor`. The condition is always false, so customers are linked using `productId`.

**File:** `src/components/dashboard/top-revenue-widget.tsx`.

**Implementation:**

1. Select `customerId` versus `productId` from the explicit `kind` state, not inferred object properties.
2. Preserve dates, warehouse, category, segment, locale, and permission-aware link behavior.
3. Prefer a testable typed URL builder if it also serves the other drill-down fixes.

**Regression tests:**

- Customer mode produces `customerId=<customer id>` and no `productId`.
- Product mode produces `productId=<product id>` and no `customerId`.
- Toggle between modes and click each destination in a real browser.
- Non-drill-down roles still receive no unauthorized links.

### 4. High: reconcile line-filtered revenue with invoice drill-downs

**Problem:** Dashboard product/category revenue sums matching lines. The invoice list filters to invoices containing those lines, then displays full invoice totals. A category-A chart showing MAD 100 can lead to an invoice showing MAD 300 because it also contains MAD 200 of category B.

**Files:**

- `src/server/queries/dashboard.ts` — line-based revenue filters
- `src/server/queries/invoices.ts` — matching-order filter and invoice selections
- Invoice list UI and relevant dashboard drill-down components

**Recommended design:** Keep the invoice ledger destination, preserve full invoice totals, and add an explicitly labeled **matching-line revenue** amount plus a filtered subtotal when product/category filters are active.

**Implementation:**

1. Define one matching-line predicate for category/product intersections, scoped to the organization.
2. Return matching-line revenue separately from full invoice totals. Never redefine the invoice's legal/business total to mean a subset of lines.
3. Add a filtered summary across **all matching invoices**, not only the current page, so it reconciles to the originating KPI/chart.
4. Preserve full invoice payment/balance semantics; do not allocate payments or receivables to categories/products without an allocation contract.
5. Make the UI explicit about matching-line revenue versus invoice totals and translate it into English/French.
6. Update `docs/METRICS.md` with the drill-down contract.

**Regression tests:**

- An invoice containing category A = 10,000 and B = 20,000 minor units: A-filtered dashboard and drill-down matching subtotal both equal 10,000; full invoice total remains 30,000.
- Product-only, category-only, combined product/category, and nonmatching intersection cases.
- Multiple invoices and more than one page: filtered subtotal remains correct independently of pagination.
- Customer/date/warehouse/segment filters compose correctly; no cross-organization data is included.

### 5. Medium: make funnel stage destinations match their counts

**Problem:** Created, Sent, Accepted, Order created, Invoiced, and Paid all link to the same unfiltered quote cohort.

**Files:**

- `src/components/dashboard/analytics-widgets.tsx` — `QuoteFunnelWidget`
- `src/server/queries/dashboard.ts` — `getQuoteFunnel`
- `src/lib/quotes/filters.ts`
- `src/server/queries/quotes.ts`
- Quote list/detail URL preservation and UI

**Implementation:**

1. Add a validated, explicit funnel-stage filter to the quote ledger contract, e.g. `funnelStage=sent|accepted|converted|invoiced|paid` (with the created stage meaning the whole cohort).
2. Match the existing funnel's cumulative semantics:
   - Created: all quotes in the selected creation-date cohort.
   - Sent: `sentAt` is present, including subsequently accepted/converted quotes.
   - Accepted: `acceptedAt` is present, including converted quotes.
   - Order created: a downstream source-quote order exists.
   - Invoiced: a downstream invoice exists.
   - Paid: the downstream order meets the same settlement condition as the funnel query.
3. Do not substitute current quote status for historical cumulative stages. For example, `status=sent` would exclude converted quotes that were previously sent.
4. Preserve cohort creation dates, warehouse, category, segment, locale, and pagination/detail-back behavior.
5. Use tenant-scoped existence predicates or equivalent distinct logic so multiple lines do not duplicate quotes.
6. Clearly label the active stage in the ledger and provide a way to clear it.

**Regression tests:**

- Build a nonempty cohort spanning draft, rejected, accepted, converted, invoiced, and paid outcomes.
- For every stage, assert the funnel count equals the quote-list total for its drill-down URL.
- Include multi-line quotes, other organizations, and quotes outside the date cohort.
- Verify actual stage clicks and Back navigation in the browser.

### 6. Medium: stop mixing filter scopes in DSO

**Problem:** Receivables ignore category/warehouse by contract, but DSO divides those organization/segment balances by category/warehouse-filtered revenue. This produces a misleading estimate when either unsupported dimension is selected.

**File:** `src/app/[locale]/(app)/dashboard/page.tsx` — DSO value, comparison, and sparkline calculations.

**Recommended design:** Make DSO unavailable when warehouse or category filters are active. This is the smallest change consistent with the existing receivables filter contract.

**Implementation:**

1. Define a single DSO applicability rule used for its value, comparison delta, and sparkline.
2. With unsupported dimensions active, display a clear localized explanation and no misleading number/delta/sparkline.
3. With only supported segment/date filters, compute both numerator and denominator for the same segment/scope and keep the prior-period calculation consistent.
4. Retain unavailable behavior at zero revenue; never use zero as a substitute for a failed query.
5. Document the applicability rule in `docs/METRICS.md`.

**Regression tests:**

- Unfiltered/segment-filtered DSO matches receivables ÷ same-scope revenue × period days.
- Category and warehouse selections make DSO unavailable, including its comparison and sparkline.
- Zero revenue and failed data sources remain unavailable rather than zero/infinity.

## Verification and release gate

Run these against the final changes, not just an intermediate version:

```text
npm run lint
npm run typecheck
npm test
npm run db:check
npm run verify:foundations
npm run verify:orders
npm run verify:customers
npm run verify:quotes
npm run verify:invoices
npm run build
git diff --check
```

- Add/update a dedicated dashboard verifier if needed; current `verify:invoices` includes dashboard assertions but uses a one-product/one-invoice fixture that misses several failures above.
- Run local app/browser checks on the correct origin (the previous verification used `http://localhost:3001`). Set verification commands' auth/app origin consistently with the running server.
- Run browser-backed checks serially where they share demo identities, stock, or auth rate limits.
- Check actual form submissions, both Top Revenue modes, each funnel stage, filtered totals, copied URLs, pagination, refresh/Back, FR/EN, and mobile layout.
- Verify Warehouse receives no financial fields, Viewer sees only permitted summaries/links, and Accountant/Sales/Admin retain their existing access.
- Re-run mobile accessibility/console checks after UI edits. Previous dashboard accessibility audit reached 100, but that does not establish functional correctness.
- The Windows native SWC warning is known; the repository uses the Webpack/WASM fallback. Report new failures separately.
- `next start` does not load `.env.development.local` automatically. For a local production-runtime smoke test, explicitly load ignored **local** environment values without printing them or using placeholder Neon URLs. Sign-in rate limits can return 429 during repeated tests; do not disable production protections to make a verifier pass.
- Do not seed/migrate during builds or run tests against remote/production data.

## Completion criteria and handoff report

1. Each of the six findings has a regression test that failed before its fix and passes afterward.
2. Dashboard values and their filtered destinations reconcile with multi-line/multi-customer fixtures.
3. Ordinary browser filter submissions work without hand-editing query strings.
4. All required commands and browser checks pass, or specific blockers are reported honestly.
5. Correct `IMPLEMENTATION_PLAN.md` status while fixes remain open; restore “complete” only after the release gate passes. Do not weaken acceptance criteria to match implementation gaps.
6. Report changed files, test commands/results, any remaining limitations, and commit/push status. Do not begin Milestone 2 as part of this work.

## Completion record

- Blank optional controls are normalized at the shared filter boundary while malformed and unknown filters remain rejected.
- Revenue ranking is numeric and deterministic; PostgreSQL fixtures cover more than ten customer/product groups and tied values.
- Top-revenue links use explicit customer/product dimensions.
- Category/product-filtered invoice destinations retain full invoice/payment semantics and show matching-line revenue per invoice and across all filtered pages. Mixed-category fixtures prove reconciliation.
- Funnel stages have validated, permission-checked list filters and preserve cohort/dimension state through pagination and detail-back navigation. PostgreSQL fixtures include converted, invoiced, and paid outcomes.
- DSO is unavailable for warehouse/category scopes and at zero revenue; its value, delta, and sparkline share the same applicability rule.
- Mutation checks confirmed the focused tests fail when each of the six fixes is deliberately reverted.
- Final local gate passed: lint, typecheck, 37 unit tests, `db:check`, foundations/orders/customers/quotes/invoices verifiers, production build, and mobile Lighthouse accessibility (100).
- Optional production `next start` multi-role verification was throttled (HTTP 429) on the last Viewer sign-in after preceding role checks. The complete role/browser suite passed on the local development server; production deployment remains deferred.
