# Human Test Plan: Simplified Exports

## Prerequisites

- Node.js 18+ installed
- Project dependencies installed (`npm install`)
- All automated tests passing:
  ```
  npx vitest run
  ```
  Expected: 181 tests, 10 files, all passing
- Build succeeds:
  ```
  npm run build
  ```

## Phase 1: Package Export Verification (AC1.2, AC1.3, AC1.4)

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open `package.json` and inspect the `"exports"` field | The `"exports"` object contains exactly one key: `"."`. It should NOT contain `"./client"`, `"./server"`, or `"./session"`. The full exports block should be: `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` |
| 1.2 | Run `npm run build` from the project root | Build completes without errors. Output directory `dist/` is created. |
| 1.3 | Verify `dist/index.js` does not re-export from `client.js` | Run: `grep -r "client" dist/index.js`. Should find no references to a `client.js` module. |
| 1.4 | Verify `dist/` directory structure reflects new module layout | Expected files: `http-batch.js`, `websocket.js`, `core.js`, `session.js`, `index.js`. The files `session.js` and `core.js` exist but are only accessible via `index.js` re-exports, not via separate package export paths. |
| 1.5 | (Optional) Create a scratch file outside the package directory with `import {} from "@jmorrell/jsonrpc/client"`. Run with node. | Module resolution should fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. |

## Phase 2: API Surface Verification

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Inspect `src/index.ts` | Exactly 7 runtime exports: `newHttpBatchRpcResponse`, `newHttpBatchRpcSession`, `newWorkersWebSocketRpcResponse`, `newWebSocketRpcSession`, `newWorkersRpcResponse`, `RpcError`, `RpcProtocolError`. Plus type exports for `RpcTransport`, `RpcFetchOptions`, `RpcClientOptions`, `RpcProtocolErrorCode`, `RpcHandlerOptions`, `PromisifyMethods`, `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcSuccessResponse`, `JsonRpcErrorResponse`. |
| 2.2 | Verify `newWorkersRpcResponse` is defined inline in `index.ts` | The dispatcher function should be defined directly in `index.ts`, importing `newHttpBatchRpcResponse` and `newWorkersWebSocketRpcResponse` internally. |

## Phase 3: Workers Runtime End-to-End

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Run `npx vitest run src/__tests__/workers.workers.test.ts --reporter=verbose` | All 12 Workers tests pass. Output shows tests running in the `\|workers\|` pool (workerd runtime). |
| 3.2 | Observe the "AC1.1" test group | Three tests pass: exports resolve with correct types, RpcError instantiation, RpcProtocolError instantiation. |
| 3.3 | Observe the WebSocket round-trip test | "should handle WebSocket RPC round-trip" passes: sends `add(5, 3)` over WebSocket, receives `result: 8`. |
| 3.4 | Observe the bidirectional WebSocket test | "should support bidirectional communication over WebSocket" passes: sends two requests, receives both responses. |

## Phase 4: HTTP Batch Round-Trip

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Run `npx vitest run src/__tests__/e2e.test.ts --reporter=verbose` | All 6 integration tests pass: single call, batch of 3, void return, error propagation, mixed batch, method-not-found. |
| 4.2 | Run `npx vitest run src/__tests__/client.test.ts --reporter=verbose` | All 15 client tests pass including batching behavior and Symbol.dispose tests. |
| 4.3 | Run `npx vitest run src/__tests__/dispatcher.test.ts --reporter=verbose` | All 12 dispatcher tests pass including POST with CORS, WebSocket routing, and 400 fallback. |

## Phase 5: Regression Check

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Run `npx vitest run src/__tests__/core.test.ts --reporter=verbose` | All existing core tests pass unchanged. |
| 5.2 | Run `npx vitest run src/__tests__/session.test.ts --reporter=verbose` | All existing session tests pass unchanged. |
| 5.3 | Run `npx vitest run src/__tests__/spec.test.ts --reporter=verbose` | All JSON-RPC spec compliance tests pass with updated imports. |
| 5.4 | Run `npx vitest run src/__tests__/property.test.ts --reporter=verbose` | All 4 property-based tests pass. |

## Traceability Matrix

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 -- All 7 exports resolve | `workers.workers.test.ts` "should export all 7 required symbols" | Phase 3, Step 3.2 |
| AC1.2 -- /client fails | -- | Phase 1, Steps 1.1 + 1.5 |
| AC1.3 -- /server fails | -- | Phase 1, Steps 1.1 + 1.5 |
| AC1.4 -- /session fails | -- | Phase 1, Steps 1.1 + 1.5 |
| AC2.1 -- HTTP server POST | `server.test.ts` "returns 200 with JSON body" | Phase 4, Step 4.1 |
| AC2.2 -- HTTP client batching | `client.test.ts` "two synchronous calls produce one batch request" | Phase 4, Step 4.2 |
| AC2.3 -- HTTP server 405 | `server.test.ts` "returns 405 for non-POST requests" | Phase 4, Step 4.1 |
| AC2.4 -- HTTP client errors | `client.test.ts` "batch with mixed successes and errors" | Phase 4, Step 4.2 |
| AC3.1 -- HTTP session Symbol.dispose | `client.test.ts` "has Symbol.dispose property" | Phase 4, Step 4.2 |
| AC3.2 -- WS session Symbol.dispose | `websocket.test.ts` "AC3.2" | Phase 3, Step 3.1 |
| AC3.3 -- WS dispose closes WS | `websocket.test.ts` "AC3.3" | Phase 3, Step 3.1 |
| AC3.4 -- Symbol.dispose non-enumerable | `client.test.ts` "Symbol.dispose is non-enumerable" | Phase 4, Step 4.2 |
| AC4.1 -- WS server 101 | `websocket.test.ts` + `workers.workers.test.ts` | Phase 3, Step 3.1 |
| AC4.2 -- WS server exposes service | `websocket.test.ts` + `workers.workers.test.ts` | Phase 3, Step 3.3 |
| AC4.3 -- WS server service optional | `websocket.test.ts` (no service arg) | Phase 3, Step 3.1 |
| AC4.4 -- WS server 400 | `websocket.test.ts` + `workers.workers.test.ts` | Phase 3, Step 3.1 |
| AC5.1 -- WS client with URL | `websocket.test.ts` "AC5.1" | Phase 3, Step 3.1 |
| AC5.2 -- WS client with existing WS | `websocket.test.ts` "AC5.2" | Phase 3, Step 3.1 |
| AC5.3 -- WS client bidirectional | `websocket.test.ts` "AC5.3" | Phase 3, Steps 3.1 + 3.4 |
| AC5.4 -- WS message queuing | `websocket.test.ts` "AC5.4" | Phase 3, Step 3.1 |
| AC6.1 -- Dispatcher POST + CORS | `dispatcher.test.ts` + `workers.workers.test.ts` | Phase 4, Step 4.3 |
| AC6.2 -- Dispatcher WS upgrade | `dispatcher.test.ts` + `workers.workers.test.ts` | Phase 3, Step 3.1 |
| AC6.3 -- Dispatcher 400 fallback | `dispatcher.test.ts` + `workers.workers.test.ts` | Phase 4, Step 4.3 |
| AC7.1 -- Existing tests pass | `core.test.ts`, `session.test.ts`, `spec.test.ts`, `property.test.ts` | Phase 5, Steps 5.1-5.4 |
| AC7.2 -- E2E round-trip passes | `e2e.test.ts` + `workers.workers.test.ts` | Phase 4, Step 4.1 + Phase 3 |
