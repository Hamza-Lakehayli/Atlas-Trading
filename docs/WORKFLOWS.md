# Initial business workflow contracts

## Sales order lifecycle

```text
draft → confirmed → shipped → invoiced → paid
  └──────────→ cancelled
```

- Drafts are editable; confirmation validates customer, lines, prices, warehouse, and permission.
- Shipping is all-or-nothing in the MVP. Stock is validated and reduced atomically.
- Invoicing requires a shipped order; one invoice per order in v1.
- Payments may be partial; the invoice is settled only when its remaining balance is zero.
- Draft and confirmed orders may be cancelled. Shipped or invoiced orders cannot be cancelled in v1.
- Repeated shipping, invoice creation, quote conversion, or payment requests must not duplicate effects.
- Idempotency keys are scoped by organization and operation; reusing a key with a different payload is rejected.
- Idempotency keys are scoped by organization and operation; reusing a key with a different request payload is rejected.
- State changes record event timestamps and append audit records within the same transaction.

## Inventory and costing

- Negative inventory is prohibited.
- Adjustments require a reason.
- Transfers create paired outgoing/incoming movements atomically.
- Moving weighted-average cost is maintained per product/warehouse.
- Fulfillment captures cost; historical gross margin never uses today's product cost.
- Partial fulfillment, returns, refunds, and credit notes are deferred.

## Authentication and demo roles

- Public registration is disabled.
- Five seeded users represent Admin, Sales manager, Warehouse, Accountant, and Viewer.
- Demo sign-in uses a deliberately shared public showcase password configured per environment; it is not suitable for real users. Set `DEMO_MODE=true` explicitly to enable it.
- The role is a server-owned `appRole` field, never accepted from login form input.
- Every protected page, query, mutation, and export checks permissions on the server.
- The demo Admin role does not grant hosting or infrastructure administration.

## Copilot placeholder

The `/copilot` page is informational only. There are no AI network calls, generated SQL, tools, proposal actions, MCP endpoint, approval queue, or runtime. Reconsider activation only at the end of the ERP project with an explicit owner decision.
