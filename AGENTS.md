# @jmorrell/jsonrpc

Last verified: 2026-02-14

## Tech Stack

- Language: TypeScript 5.x (ES2022 target, ESM)
- Testing: Vitest, fast-check (property-based)
- Build: tsc (declarations + JS output to dist/)
- Runtime target: Cloudflare Workers (uses Web APIs: Request, Response, fetch)

## Commands

- `npm run build` - Compile TypeScript to dist/
- `npm run test` - Run tests (vitest run)
- `npm run test:watch` - Watch mode

## Project Structure

- `src/types.ts` - All shared type definitions and error classes (wire format, transport, session, RpcProtocolError)
- `src/core.ts` - Transport-agnostic JSON-RPC 2.0 engine (type guards, request/response builders, RPC processor)
- `src/client.ts` - HTTP client with auto-batching via Proxy
- `src/server.ts` - HTTP server wrapper (Request in, Response out)
- `src/session.ts` - Bidirectional RPC over message transports (WebSocket-style)
- `src/__tests__/` - Test files
- `docs/` - Design documents and implementation plans

## Package Entry Points

Three public entry points (no barrel index.ts):

- `@jmorrell/jsonrpc/client` - rpcClient, RpcError, createRequest, isJsonRpcResponse
- `@jmorrell/jsonrpc/server` - handleRpc, processRpc, isJsonRpcRequest, RpcProtocolError, RpcProtocolErrorCode
- `@jmorrell/jsonrpc/session` - rpcSession, RpcError, RpcProtocolError, RpcProtocolErrorCode

## Conventions

- Zero runtime dependencies
- By-position params only (arrays, not named objects) per JSON-RPC 2.0
- No barrel index.ts -- consumers import specific entry points
- core.ts is internal; client, server, session re-export what they need from it
- Notifications are not supported (ignored server-side, no client API)

## Module Dependency Rules

- types.ts: no internal imports (leaf module)
- core.ts: imports only from types.ts
- client.ts: imports from types.ts and core.ts
- server.ts: imports from types.ts and core.ts
- session.ts: imports from types.ts and core.ts
- No cross-imports between client, server, and session
