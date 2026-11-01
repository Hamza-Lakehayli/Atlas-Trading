# Metric contracts

These are the initial implementation definitions. Keep dashboard cards, charts, reports, and drill-down queries consistent with this file.

| Metric | Definition | Period basis |
| --- | --- | --- |
| Revenue | Net issued invoice amount | `issued_at` within `[start, end)` |
| Gross margin | `(net invoiced revenue - invoiced COGS) / net invoiced revenue`; unavailable at zero revenue | Invoice cohort |
| Orders | Distinct orders confirmed | `confirmed_at` within `[start, end)` |
| Average order value | Net invoiced revenue / distinct invoiced orders in the same invoice period | Invoice cohort; chosen to avoid mixing confirmed-order and invoice cohorts |
| Receivables | Remaining invoice balance at the selected as-of instant | Includes only payments at/before that instant |
| DSO | Period-end receivables / period revenue × period day count | Simplified estimate; unavailable at zero revenue |
| Inventory value | Quantity × carried moving-average cost | As of selected business date |
| Low-stock SKUs | Active products whose total stock is at/below product reorder point | Initial single threshold; warehouse-specific thresholds are a later inventory schema step |
| On-time delivery | Shipped orders delivered no later than promised date / orders shipped in period | `shipped_at` cohort |
| Inventory turnover | Period COGS / average inventory value | Daily snapshots preferred |

## General rules

- Money is integer MAD minor units in storage and exact arithmetic in calculations.
- Business time zone is `Africa/Casablanca`; database timestamps are UTC.
- Date windows are half-open: `[start, end)`.
- Comparisons use equal-length adjacent periods unless the selected comparison is explicitly prior year.
- Missing history is labeled insufficient data. Zero denominators are unavailable, never infinity.
- AR aging has a separate not-yet-due bucket and nonoverlapping overdue buckets: 1–30, 31–60, 61–90, 91+ days.
- Funnel conversion uses one quote cohort and its downstream outcomes.
- Distinct order totals must not be calculated by adding category-level distinct-order counts.

## Filter applicability

| Widget family | Warehouse | Category | Customer segment | Notes |
| --- | --- | --- | --- | --- |
| Sales / invoiced revenue | Yes | Yes | Yes | Source dimensions must support each filter. |
| Order volume | Yes | Yes, if line-based with distinct-order logic | Yes | Do not sum category distinct counts. |
| Receivables | No | No | Yes | Category allocation is not defined; do not invent it. |
| Inventory health/value | Yes | Yes | No | Customer segment is not meaningful without an allocation model. |

Unsupported filters must be disabled or clearly identified. Never silently ignore a filter.
