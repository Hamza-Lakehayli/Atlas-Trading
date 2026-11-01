# ADR 0003: Defer operational copilot

- **Status:** Accepted for current project scope
- **Decision date:** 2026-10-31

## Decision

Implement only an honest, nonfunctional `/copilot` placeholder. Do not connect a model provider, install an agent runtime, create an MCP endpoint or proposal system, or provision a VM/cloud resource. Revisit activation after the ERP project is complete and the owner has evaluated value and cost across their projects.

## Rationale

The owner has limited shared infrastructure credits and wants to preserve them for multiple projects. The core ERP should be useful and portfolio-ready without a running AI service.

## Consequences

- Copilot functionality is not a release acceptance criterion.
- The placeholder must clearly disclose that no model is connected.
- Any later implementation requires a separate decision and security/cost plan.
