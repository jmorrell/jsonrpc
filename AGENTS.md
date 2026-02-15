# @jmorrell/jsonrpc

Last verified: 2026-02-14

## Tech Stack

- Language: TypeScript 5.x (ES2022 target, ESM)
- Formatting: oxfmt (config in .oxfmtrc.json)
- Linting: oxlint (default correctness rules)
- Testing: Vitest, fast-check (property-based)
- Build: tsc (declarations + JS output to dist/)
- CI: GitHub Actions (fmt:check, lint, build, test on PRs and pushes to main)
- Runtime target: Cloudflare Workers (uses Web APIs: Request, Response, fetch)

## Commands

- `npm run build` - Compile TypeScript to dist/
- `npm run fmt` - Format all files (oxfmt)
- `npm run fmt:check` - Check formatting without modifying files
- `npm run lint` - Lint with oxlint
- `npm run lint:fix` - Lint and auto-fix
- `npm run test` - Run tests (vitest run)
- `npm run test:watch` - Watch mode

## Project Structure

- `src/core.ts` - Shared types, error classes, and transport-agnostic JSON-RPC 2.0 engine (wire format types, type guards, request/response builders, RpcProtocolError, RPC processor)
- `src/http-batch.ts` - HTTP batch transport: newHttpBatchRpcResponse (server) + newHttpBatchRpcSession (client with auto-batching)
- `src/session.ts` - Bidirectional RPC over message transports (defines session-specific types: RpcMessageTransport, RpcSessionOptions, RpcSession)
- `src/__tests__/` - Test files
- `docs/` - Design documents and implementation plans

## Package Entry Points

Single public entry point via index.ts:

- `@jmorrell/jsonrpc` - newHttpBatchRpcResponse, newHttpBatchRpcSession, RpcError, RpcProtocolError

## Conventions

- Zero runtime dependencies
- By-position params only (arrays, not named objects) per JSON-RPC 2.0
- Single entry point via index.ts -- consumers import from @jmorrell/jsonrpc
- core.ts is internal; public API re-exports what consumers need from it
- Notifications are not supported (ignored server-side, no client API)

## Module Dependency Rules

- core.ts: no internal imports (leaf module, defines all shared types and logic)
- http-batch.ts: imports from core.ts
- session.ts: imports from core.ts
- index.ts: re-exports from http-batch.ts and core.ts
- No cross-imports between http-batch and session
