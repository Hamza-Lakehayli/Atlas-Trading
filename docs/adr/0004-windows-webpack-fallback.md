# ADR 0004: Webpack fallback for this Windows environment

- **Status:** Temporary environment workaround
- **Decision date:** 2026-10-31

## Context

Next.js 16.4.3's installed `@next/swc-win32-x64-msvc` native module fails to load in this workspace (`not a valid Win32 application`). Next falls back to WASM, but the Turbopack dev/build commands require native bindings and cannot run here.

## Decision

Use `next dev --webpack` and `next build --webpack` in the package scripts so local development and production builds can be verified with the available WASM bindings.

## Consequences

- The project does not currently verify Turbopack behavior or performance locally.
- Builds emit a native SWC warning but complete successfully through WASM and webpack.
- Revisit this workaround when the Windows package/runtime issue is corrected; do not treat webpack timings as Turbopack performance evidence.
- The Next.js 16.3+ `/_next/mcp` + Turbopack development inspection workflow could not be used in this environment.
