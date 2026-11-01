# ADR 0002: Shared demo organization and application roles

- **Status:** Accepted
- **Decision date:** 2026-10-31

## Decision

Run one shared demo organization in v1. Include organization IDs on business records and enforce organization scope in services and queries. Store the five application roles in a server-owned `appRole`; define permissions centrally and enforce them in server code.

## Rationale

This provides a realistic role demonstration without claiming full multi-tenant isolation or introducing PostgreSQL RLS as a prerequisite.

## Consequences

- User-interface visibility is not the security boundary.
- Every data access path is organization- and permission-scoped.
- Warehouse users must not receive finance fields in payloads.
- Shared demo users can affect the same demo data; reset/isolation limitations must be disclosed.
- Public sign-up remains disabled and demo Admin does not administer infrastructure.
