# @jmorrell/jsonrpc

Last verified: 2026-02-16

## Tech Stack

- Language: TypeScript 5.x (ES2022 target, ESM)
- Formatting: oxfmt (config in .oxfmtrc.json)
- Linting: oxlint (default correctness rules)
- Testing: Vitest with fast-check (property-based). Dual workspace:
  - `unit` project: regular tests in src/**tests**/\*.test.ts
  - `workers` project: Workers runtime tests in src/**tests**/\*.workers.test.ts (uses @cloudflare/vitest-pool-workers)
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
- `src/session.ts` - Bidirectional RPC over message transports (defines session-specific types: RpcTransport, RpcSessionOptions, RpcSession)
- `src/websocket.ts` - WebSocket transport: newWorkersWebSocketRpcResponse (server, fire-and-forget) + newWorkersWebSocketRpcSession (server, bidirectional with typed remote proxy) + newWebSocketRpcSession (client with Disposable proxy)
- `src/__tests__/` - Test files
- `src/__tests__/fixtures/worker.ts` - Test worker entry point for Workers runtime tests
- `src/__tests__/fixtures/wrangler.toml` - Minimal Workers config for test worker

## Package Entry Points

Single public entry point via index.ts:

- `@jmorrell/jsonrpc` - newHttpBatchRpcResponse, newHttpBatchRpcSession, newWorkersWebSocketRpcResponse, newWorkersWebSocketRpcSession, newWebSocketRpcSession, newWorkersRpcResponse, RpcSession, processRpc, RpcError, RpcProtocolError (plus type exports: RpcRequestFn, RpcFetchOptions, RpcClientOptions, RpcTransport, RpcSessionOptions, RpcHandlerOptions, RpcProtocolErrorCode, PromisifyMethods, JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse)

## Conventions

- Always run `npm run fmt` before committing to ensure code passes CI formatting checks
- Zero runtime dependencies
- By-position params only (arrays, not named objects) per JSON-RPC 2.0
- Single entry point via index.ts -- consumers import from @jmorrell/jsonrpc
- core.ts is internal; public API re-exports what consumers need from it
- Notifications are not supported (ignored server-side, no client API)

## Module Dependency Rules

- core.ts: no internal imports (leaf module, defines all shared types and logic)
- http-batch.ts: imports from core.ts
- session.ts: imports from core.ts
- websocket.ts: imports from core.ts and session.ts
- index.ts: re-exports from http-batch.ts, session.ts, websocket.ts, and core.ts
- No cross-imports between http-batch and session; websocket.ts may import from session.ts
