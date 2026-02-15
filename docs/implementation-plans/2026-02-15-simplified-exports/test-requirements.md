# Test Requirements — simplified-exports

**Generated:** 2026-02-15
**Source:** Acceptance criteria from phase_01.md through phase_04.md

This document maps every `simplified-exports.AC*` acceptance criterion to either an automated test or a documented human verification step. Each entry includes the phase where the AC is introduced, the test type, the expected file path, and a rationale tied to implementation decisions from the planning phase.

---

## Conventions

- **Test file paths** reflect the post-Phase-2 naming (imports updated to new module names).
- **Unit tests** exercise a single function in isolation with mocked dependencies.
- **Integration tests** exercise two or more modules together (e.g., client + server via in-memory transport).
- **E2E tests** exercise the full stack in a real runtime (Workers pool via workerd).
- **Human verification** is reserved for criteria that cannot be expressed as a deterministic assertion.

---

## AC1: Single entry point

### simplified-exports.AC1.1 -- All 7 exports resolve from `@jmorrell/jsonrpc`

| Field | Value |
|-------|-------|
| **Criterion** | `import { newHttpBatchRpcResponse, newHttpBatchRpcSession, newWorkersWebSocketRpcResponse, newWebSocketRpcSession, newWorkersRpcResponse, RpcError, RpcProtocolError } from "@jmorrell/jsonrpc"` resolves all exports. |
| **Phase** | 3 (Task 6 adds WebSocket re-exports to index.ts, completing the full set) |
| **Test type** | E2E (Workers runtime) |
| **Test file** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Import all 7 symbols from the package entry point in a Workers runtime test and assert each is defined and has the expected type (function or class). This validates that the package.json `exports` field, `dist/index.js`, and all re-export chains resolve correctly in a real module resolution context. |
| **Rationale** | The unit tests import via relative paths (`../http-batch.js`, `../core.js`), which bypass the `exports` field. Only an E2E test that imports from `@jmorrell/jsonrpc` validates AC1.1 end-to-end. The Workers pool test environment resolves the package as a consumer would. |

### simplified-exports.AC1.2 -- `@jmorrell/jsonrpc/client` fails to resolve

| Field | Value |
|-------|-------|
| **Criterion** | `import ... from "@jmorrell/jsonrpc/client"` fails to resolve (old entry point removed). |
| **Phase** | 1 (Task 3 replaces the `exports` field in package.json) |
| **Test type** | Human verification |
| **Justification** | Module resolution failures are static -- they occur at import time, not at runtime. A test that attempts to import a nonexistent path would fail to compile or would require dynamic `import()` with error catching, which tests the runtime module loader rather than the package contract. The `exports` field change is the operative mechanism: removing `"./client"` from `exports` guarantees resolution failure for any consumer using standard Node/bundler module resolution. |
| **Verification approach** | After Phase 1 Task 3 is complete: (1) Verify `package.json` `exports` field contains only `"."` and no `"./client"` key. (2) Run `npm run build` and confirm `dist/client.js` is not referenced by `dist/index.js`. (3) Optionally, in a scratch file outside the package, attempt `import {} from "@jmorrell/jsonrpc/client"` and confirm a module resolution error. Re-verified in Phase 4 Workers runtime. |

### simplified-exports.AC1.3 -- `@jmorrell/jsonrpc/server` fails to resolve

| Field | Value |
|-------|-------|
| **Criterion** | `import ... from "@jmorrell/jsonrpc/server"` fails to resolve (old entry point removed). |
| **Phase** | 1 (Task 3) |
| **Test type** | Human verification |
| **Justification** | Same reasoning as AC1.2. The `exports` field no longer includes `"./server"`. |
| **Verification approach** | Same as AC1.2, substituting `/server` for `/client`. |

### simplified-exports.AC1.4 -- `@jmorrell/jsonrpc/session` fails to resolve

| Field | Value |
|-------|-------|
| **Criterion** | `import ... from "@jmorrell/jsonrpc/session"` fails to resolve (old entry point removed). |
| **Phase** | 1 (Task 3) |
| **Test type** | Human verification |
| **Justification** | Same reasoning as AC1.2. The `exports` field no longer includes `"./session"`. |
| **Verification approach** | Same as AC1.2, substituting `/session` for `/client`. |

---

## AC2: HTTP batch functions (capnweb-compatible)

### simplified-exports.AC2.1 -- `newHttpBatchRpcResponse` handles POST and returns JSON-RPC response

| Field | Value |
|-------|-------|
| **Criterion** | `newHttpBatchRpcResponse` handles POST request and returns JSON-RPC response. |
| **Phase** | 2 (Task 5 updates server.test.ts) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/server.test.ts` |
| **Test description** | Existing test "returns 200 with JSON body for normal request" -- sends a POST with a valid JSON-RPC request body and asserts the response is status 200 with the correct JSON-RPC result. After Phase 2, this test calls `newHttpBatchRpcResponse` (renamed from `handleRpc`). Additional coverage in `src/__tests__/spec.test.ts` (spec compliance: "-32700 Parse error (via handleRpc)" renamed to use `newHttpBatchRpcResponse`). |
| **Rationale** | The function body is identical to the original `handleRpc` -- only the name changes. Existing tests provide full coverage after import renaming. |

### simplified-exports.AC2.2 -- `newHttpBatchRpcSession` creates auto-batching client proxy

| Field | Value |
|-------|-------|
| **Criterion** | `newHttpBatchRpcSession` creates auto-batching client proxy; concurrent calls batched in single request. |
| **Phase** | 2 (Task 3 updates client.test.ts) |
| **Test type** | Unit + Integration |
| **Test file (unit)** | `src/__tests__/client.test.ts` |
| **Test file (integration)** | `src/__tests__/e2e.test.ts` |
| **Test description** | Unit: "two synchronous calls produce one batch request" -- makes two concurrent calls via `Promise.all`, asserts only one transport call was made with an array payload. Integration (e2e): "batch of 3 calls" -- uses in-memory transport to verify 3 concurrent calls produce correct results through `processRpc`. After Phase 2, both files import `newHttpBatchRpcSession` (renamed from `rpcClient`). |
| **Rationale** | Auto-batching is the core differentiator of the HTTP client. The unit test verifies the batching mechanism in isolation; the e2e test verifies it works end-to-end through the server processing pipeline. |

### simplified-exports.AC2.3 -- `newHttpBatchRpcResponse` returns 405 for non-POST

| Field | Value |
|-------|-------|
| **Criterion** | `newHttpBatchRpcResponse` returns 405 for non-POST requests. |
| **Phase** | 2 (Task 5 updates server.test.ts) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/server.test.ts` |
| **Test description** | Existing test "returns 405 for non-POST requests" -- sends a GET request and asserts status 405 with `Allow: POST` header. After Phase 2, calls `newHttpBatchRpcResponse`. |
| **Rationale** | Direct unit test of the guard clause at the top of the function. |

### simplified-exports.AC2.4 -- `newHttpBatchRpcSession` propagates server errors as `RpcError`

| Field | Value |
|-------|-------|
| **Criterion** | `newHttpBatchRpcSession` propagates server errors as `RpcError`. |
| **Phase** | 2 (Task 3 updates client.test.ts, Task 6 updates e2e.test.ts) |
| **Test type** | Unit + Integration |
| **Test file (unit)** | `src/__tests__/client.test.ts` |
| **Test file (integration)** | `src/__tests__/e2e.test.ts` |
| **Test description** | Unit: "batch with mixed successes and errors" -- asserts the failed call rejects with `RpcError` containing the correct code and message. Also "server returns single error object for batch -> all reject". Integration (e2e): "error propagation: server throws -> client gets RpcError" and "method not found propagates as RpcError". |
| **Rationale** | Error propagation is tested at both levels: transport-level (mocked responses with error payloads) and through real server processing (thrown errors converted to JSON-RPC error responses). |

---

## AC3: Disposable return types

### simplified-exports.AC3.1 -- `newHttpBatchRpcSession` return value has `Symbol.dispose`

| Field | Value |
|-------|-------|
| **Criterion** | `newHttpBatchRpcSession` return value has `Symbol.dispose` property. |
| **Phase** | 2 (Task 4 adds tests) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/client.test.ts` |
| **Test description** | New test: create a session proxy, assert `Symbol.dispose in proxy` is true, assert `typeof proxy[Symbol.dispose]` is `"function"`, call `proxy[Symbol.dispose]()` and assert it does not throw. The HTTP batch session has no persistent connection so dispose is a no-op, but the property must exist for `using` syntax compatibility. |
| **Rationale** | The Proxy `get` trap explicitly returns `() => {}` for `Symbol.dispose`. A unit test with a mock transport is sufficient to verify the property exists and is callable. |

### simplified-exports.AC3.2 -- `newWebSocketRpcSession` return value has `Symbol.dispose`

| Field | Value |
|-------|-------|
| **Criterion** | `newWebSocketRpcSession` return value has `Symbol.dispose` property. |
| **Phase** | 3 (Task 5 adds tests) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Create a `newWebSocketRpcSession` with a mock WebSocket in OPEN state. Assert `Symbol.dispose in proxy` is true and `typeof proxy[Symbol.dispose]` is `"function"`. |
| **Rationale** | Analogous to AC3.1 but for the WebSocket session. Uses a mock WebSocket since the test runs in Node, not Workers. |

### simplified-exports.AC3.3 -- `using session = newWebSocketRpcSession(...)` disposes WebSocket on scope exit

| Field | Value |
|-------|-------|
| **Criterion** | `Symbol.dispose` on WebSocket session calls `session.close()` which closes the underlying WebSocket. |
| **Phase** | 3 (Task 5 adds tests) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Create a `newWebSocketRpcSession` with a mock WebSocket. Call `proxy[Symbol.dispose]()`. Assert that the mock WebSocket's `close()` method was called. This verifies the chain: `Symbol.dispose` -> `session.close()` -> `transport.close()` -> `ws.close()`. |
| **Rationale** | The actual `using` keyword syntax cannot be tested directly in current runtimes without transpilation, but calling `Symbol.dispose()` directly is semantically equivalent. The test verifies the dispose callback correctly tears down the WebSocket connection. |

### simplified-exports.AC3.4 -- `Symbol.dispose` is non-enumerable

| Field | Value |
|-------|-------|
| **Criterion** | `Symbol.dispose` is non-enumerable (doesn't interfere with object comparison or spread). |
| **Phase** | 2 (Task 4 adds tests) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/client.test.ts` |
| **Test description** | Create a session proxy. Assert `Object.keys(proxy)` returns an empty array. Assert spreading the proxy (`{...proxy}`) does not include a `Symbol.dispose` key. This is inherently true for Proxy `get` traps -- symbol properties accessed via `get` don't appear in `Object.keys()` or spread -- but the test documents the guarantee. |
| **Rationale** | Non-enumerability is a natural property of the Proxy pattern used, but the test makes the contract explicit. Applies to both HTTP batch and WebSocket sessions, but only tested explicitly on HTTP batch since the mechanism is identical (both use Proxy `get` traps). |

---

## AC4: WebSocket server (`newWorkersWebSocketRpcResponse`)

### simplified-exports.AC4.1 -- Returns 101 Response for WebSocket upgrade requests

| Field | Value |
|-------|-------|
| **Criterion** | `newWorkersWebSocketRpcResponse` returns 101 Response with WebSocket for upgrade requests. |
| **Phase** | 3 (Task 5 adds unit tests), 4 (Task 5 adds Workers runtime tests) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/websocket.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Use `vi.stubGlobal("WebSocketPair", MockWebSocketPair)` to mock the Workers-only `WebSocketPair` API. Create a Request with `Upgrade: websocket` header. Call `newWorkersWebSocketRpcResponse(request, service)`. Assert the response has status 101 and a `webSocket` property. E2E: In the Workers pool test, send a request with `Upgrade: websocket` header via the `SELF` binding. Assert 101 response. |
| **Rationale** | The unit test validates the function logic with mocks. The E2E test in Phase 4 validates that `WebSocketPair` and `server.accept()` work correctly in the real workerd runtime. |

### simplified-exports.AC4.2 -- Server exposes service methods callable by client

| Field | Value |
|-------|-------|
| **Criterion** | Server exposes `service` methods callable by client over WebSocket. |
| **Phase** | 3 (Task 5), 4 (Task 5) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/websocket.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Create a linked mock WebSocket pair. Use `newWorkersWebSocketRpcResponse` on one side and `newWebSocketRpcSession` on the other (or use the linked transport pattern from test-helpers.ts at the session layer). Call a method via the client proxy and verify the server-side service method is invoked and the result is returned. E2E: In Workers pool, open a WebSocket to the test worker, send a JSON-RPC request for `add(1, 2)`, and verify the response contains `result: 3`. |
| **Rationale** | The unit test covers the integration of `rpcSession` with the WebSocket transport adapter. The E2E test validates real WebSocket message exchange in workerd. |

### simplified-exports.AC4.3 -- `service` parameter is optional

| Field | Value |
|-------|-------|
| **Criterion** | `service` parameter is optional -- function succeeds without a service (client-only connection). |
| **Phase** | 3 (Task 5) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Call `newWorkersWebSocketRpcResponse(request)` with a valid upgrade request and no `service` argument (or `undefined`). Assert the response has status 101. This verifies the function defaults to an empty service object without throwing. |
| **Rationale** | The function signature makes `service` optional with a default of `{} as TLocal`. A unit test is sufficient since the default behavior is a simple fallback that doesn't depend on the runtime. |

### simplified-exports.AC4.4 -- Returns 400 for non-upgrade requests

| Field | Value |
|-------|-------|
| **Criterion** | Returns 400 for requests without `Upgrade: websocket` header. |
| **Phase** | 3 (Task 5), 4 (Task 5) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/websocket.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Create a plain GET request without upgrade header. Call `newWorkersWebSocketRpcResponse(request, service)`. Assert status 400. E2E: In Workers pool, send a GET request (no upgrade header) via `SELF.fetch()`. The dispatcher routes this to the 400 path. |
| **Rationale** | Simple guard clause. Unit test validates the logic directly; E2E validates the full dispatcher chain. |

---

## AC5: WebSocket client (`newWebSocketRpcSession`)

### simplified-exports.AC5.1 -- `newWebSocketRpcSession(url)` opens WebSocket and returns typed proxy

| Field | Value |
|-------|-------|
| **Criterion** | `newWebSocketRpcSession(url)` opens a WebSocket connection and returns a typed proxy. |
| **Phase** | 3 (Task 5), 4 (Task 5) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/websocket.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Stub `globalThis.WebSocket` with a mock constructor. Call `newWebSocketRpcSession<TestApi>("ws://localhost/rpc")`. Assert the mock WebSocket constructor was called with the URL. Assert the return value is a proxy (accessing a property returns a function). E2E: In Workers pool, the test cannot use `newWebSocketRpcSession` directly (it's a client function), but the WebSocket upgrade response path exercises the server side. The client-side URL-based connection is tested at the unit level. |
| **Rationale** | The URL code path (`typeof ws === "string" ? new WebSocket(ws) : ws`) is a one-liner. The unit test with a mocked WebSocket constructor validates the branch. Full round-trip is covered by AC4.2's E2E test from the server side. |

### simplified-exports.AC5.2 -- `newWebSocketRpcSession(existingWebSocket)` wraps existing WebSocket

| Field | Value |
|-------|-------|
| **Criterion** | `newWebSocketRpcSession(existingWebSocket)` wraps an existing WebSocket instance. |
| **Phase** | 3 (Task 5) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Create a mock WebSocket in OPEN state. Pass it directly to `newWebSocketRpcSession(mockWs)`. Verify the function does not create a new WebSocket. Verify RPC calls are forwarded through the existing mock WebSocket's `send()` method. |
| **Rationale** | The existing-WebSocket code path skips `new WebSocket(url)` and goes straight to `createWebSocketTransport(socket)`. A unit test with a mock is sufficient to verify the branch. |

### simplified-exports.AC5.3 -- `localFunctions` enables bidirectional calls

| Field | Value |
|-------|-------|
| **Criterion** | `localFunctions` parameter enables server-to-client calls (bidirectional). |
| **Phase** | 3 (Task 5) |
| **Test type** | Integration |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Create a linked mock WebSocket pair. Set up the server side with `rpcSession` as acceptor. Set up the client side with `newWebSocketRpcSession(mockWs, localFunctions)` where `localFunctions` has a method. From the server session, call the client's `localFunctions` method via `session.remote`. Assert the method was invoked and the result was returned to the server. |
| **Rationale** | Bidirectional calling is the core feature of `rpcSession` -- it's already tested in `session.test.ts`. This test specifically verifies that `newWebSocketRpcSession` correctly passes `localFunctions` to `rpcSession` as the local service object. The integration uses mock WebSockets linked together to create a full bidirectional channel. |

### simplified-exports.AC5.4 -- Messages queued while WebSocket is connecting are delivered after open

| Field | Value |
|-------|-------|
| **Criterion** | Messages queued while WebSocket is CONNECTING are delivered after the `open` event. |
| **Phase** | 3 (Task 5) |
| **Test type** | Unit |
| **Test file** | `src/__tests__/websocket.test.ts` |
| **Test description** | Create a mock WebSocket with `readyState = 0` (CONNECTING). Pass it to `newWebSocketRpcSession`. Invoke a method on the proxy (which calls `transport.send()` internally). Assert the mock WebSocket's `send()` was NOT called yet (message is queued). Simulate the `open` event on the mock WebSocket. Assert `send()` was then called with the queued message(s). |
| **Rationale** | Message queuing is handled by `createWebSocketTransport`, which checks `readyState === WebSocket.CONNECTING` and adds an `open` listener. This behavior cannot be tested in E2E (Workers WebSockets are already accepted/open), so a unit test with a mock in CONNECTING state is the only way to verify the queue-then-flush logic. |

---

## AC6: Convenience dispatcher (`newWorkersRpcResponse`)

### simplified-exports.AC6.1 -- Routes POST to `newHttpBatchRpcResponse` with CORS header

| Field | Value |
|-------|-------|
| **Criterion** | `newWorkersRpcResponse` routes POST to `newHttpBatchRpcResponse` with `Access-Control-Allow-Origin: *` header. |
| **Phase** | 3 (Task 7 adds tests), 4 (Task 5 re-verifies in Workers) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/dispatcher.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Create a POST request with a valid JSON-RPC body. Call `newWorkersRpcResponse(request, service)`. Assert the response status is 200, the body contains the expected JSON-RPC result, and the `Access-Control-Allow-Origin` header is `"*"`. E2E: In Workers pool, POST a JSON-RPC request via `SELF.fetch()`. Assert the response has the CORS header. |
| **Rationale** | The CORS header is added by the dispatcher, not by `newHttpBatchRpcResponse` itself. The unit test validates the wrapping logic. The E2E test validates the full request flow through the test worker's `fetch` handler. |

### simplified-exports.AC6.2 -- Routes `Upgrade: websocket` to `newWorkersWebSocketRpcResponse`

| Field | Value |
|-------|-------|
| **Criterion** | `newWorkersRpcResponse` routes requests with `Upgrade: websocket` header to `newWorkersWebSocketRpcResponse`. |
| **Phase** | 3 (Task 7), 4 (Task 5) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/dispatcher.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: This test requires mocking `WebSocketPair` (Workers-only API). Use `vi.stubGlobal` to provide a mock `WebSocketPair`. Create a request with `Upgrade: websocket` header. Call `newWorkersRpcResponse(request, service)`. Assert status 101. Alternatively, defer the WebSocket path to Phase 4 E2E and only validate the routing logic (header check). E2E: In Workers pool, send an upgrade request via `SELF.fetch()`. Assert 101 response with `webSocket` property. |
| **Rationale** | The dispatcher checks `request.headers.get("Upgrade") === "websocket"` before checking HTTP method. The E2E test is the definitive verification since `WebSocketPair` is only available in workerd. |

### simplified-exports.AC6.3 -- Returns 400 for other request types

| Field | Value |
|-------|-------|
| **Criterion** | Returns 400 for requests that are neither POST nor WebSocket upgrade. |
| **Phase** | 3 (Task 7), 4 (Task 5) |
| **Test type** | Unit + E2E |
| **Test file (unit)** | `src/__tests__/dispatcher.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Unit: Create a GET request (no upgrade header). Call `newWorkersRpcResponse(request, service)`. Assert status 400 and body "Bad Request". E2E: In Workers pool, send a GET request via `SELF.fetch()`. Assert status 400. |
| **Rationale** | Simple fall-through guard clause. Note: the dispatcher returns 400 (not 405) -- this is a design decision distinct from `newHttpBatchRpcResponse`'s 405 for non-POST, because the dispatcher handles multiple transports and a non-POST/non-upgrade request is simply invalid at the dispatch level. |

### simplified-exports.AC6.4 -- (Not defined)

AC6.4 is not defined in any phase file. The design document defines three behaviors for the dispatcher (POST, WebSocket upgrade, otherwise 400), fully covered by AC6.1-AC6.3. No additional test is needed.

---

## AC7: Core internals preserved

### simplified-exports.AC7.1 -- Existing core, session, spec, and property tests pass unchanged

| Field | Value |
|-------|-------|
| **Criterion** | Existing tests for core.ts, session.ts, spec compliance, and property-based tests pass with no logic changes (only import path updates). |
| **Phase** | 4 (Task 5), but verified continuously from Phase 2 onward |
| **Test type** | Unit + Integration (existing tests) |
| **Test files** | `src/__tests__/core.test.ts`, `src/__tests__/session.test.ts`, `src/__tests__/spec.test.ts`, `src/__tests__/property.test.ts` |
| **Test description** | Run the full existing test suite after all phases. Assert all tests pass. `core.test.ts` and `session.test.ts` import from `../core.js` and `../session.js` which are unchanged throughout the refactor. `spec.test.ts` and `property.test.ts` have their import paths updated in Phase 2 (Tasks 7-8: `processRpc` moves from `../server.js` to `../core.js`) but no logic changes. |
| **Rationale** | The refactor preserves all core internals. Passing tests are the strongest evidence that no regressions were introduced. The import path updates are mechanical and do not change test semantics. |

### simplified-exports.AC7.2 -- End-to-end round-trip tests pass with new API names

| Field | Value |
|-------|-------|
| **Criterion** | End-to-end round-trip tests pass with new function names (`newHttpBatchRpcSession`, `newHttpBatchRpcResponse`). |
| **Phase** | 4 (Task 5), with unit-level verification in Phase 2 (Task 6) |
| **Test type** | Integration + E2E |
| **Test file (integration)** | `src/__tests__/e2e.test.ts` |
| **Test file (e2e)** | `src/__tests__/workers.workers.test.ts` |
| **Test description** | Integration: All 6 existing e2e tests pass after renaming `rpcClient` to `newHttpBatchRpcSession` and updating `processRpc` import to `../core.js`. Tests cover single call, batch, void return, error propagation, mixed batch, and method-not-found scenarios. E2E: Workers pool test POSTs JSON-RPC requests to the test worker via `SELF.fetch()` and verifies correct responses. |
| **Rationale** | The e2e.test.ts tests exercise the full client-server round trip through an in-memory transport, proving the refactored functions compose correctly. The Workers pool tests add a real HTTP/WebSocket transport layer. |

---

## Summary Matrix

| AC | Criterion (short) | Automated? | Test Type | Test File(s) | Phase |
|----|-------------------|------------|-----------|--------------|-------|
| AC1.1 | All 7 exports resolve | Yes | E2E | workers.workers.test.ts | 3, 4 |
| AC1.2 | /client fails | No | Human | -- | 1 |
| AC1.3 | /server fails | No | Human | -- | 1 |
| AC1.4 | /session fails | No | Human | -- | 1 |
| AC2.1 | HTTP server handles POST | Yes | Unit | server.test.ts, spec.test.ts | 2 |
| AC2.2 | HTTP client auto-batching | Yes | Unit + Integration | client.test.ts, e2e.test.ts | 2 |
| AC2.3 | HTTP server 405 non-POST | Yes | Unit | server.test.ts | 2 |
| AC2.4 | HTTP client error propagation | Yes | Unit + Integration | client.test.ts, e2e.test.ts | 2 |
| AC3.1 | HTTP session has Symbol.dispose | Yes | Unit | client.test.ts | 2 |
| AC3.2 | WS session has Symbol.dispose | Yes | Unit | websocket.test.ts | 3 |
| AC3.3 | WS dispose closes WebSocket | Yes | Unit | websocket.test.ts | 3 |
| AC3.4 | Symbol.dispose non-enumerable | Yes | Unit | client.test.ts | 2 |
| AC4.1 | WS server returns 101 | Yes | Unit + E2E | websocket.test.ts, workers.workers.test.ts | 3, 4 |
| AC4.2 | WS server exposes service | Yes | Unit + E2E | websocket.test.ts, workers.workers.test.ts | 3, 4 |
| AC4.3 | WS server service optional | Yes | Unit | websocket.test.ts | 3 |
| AC4.4 | WS server 400 non-upgrade | Yes | Unit + E2E | websocket.test.ts, workers.workers.test.ts | 3, 4 |
| AC5.1 | WS client with URL | Yes | Unit | websocket.test.ts | 3 |
| AC5.2 | WS client with existing WS | Yes | Unit | websocket.test.ts | 3 |
| AC5.3 | WS client bidirectional | Yes | Integration | websocket.test.ts | 3 |
| AC5.4 | WS message queuing | Yes | Unit | websocket.test.ts | 3 |
| AC6.1 | Dispatcher POST + CORS | Yes | Unit + E2E | dispatcher.test.ts, workers.workers.test.ts | 3, 4 |
| AC6.2 | Dispatcher WS upgrade | Yes | Unit + E2E | dispatcher.test.ts, workers.workers.test.ts | 3, 4 |
| AC6.3 | Dispatcher 400 fallback | Yes | Unit + E2E | dispatcher.test.ts, workers.workers.test.ts | 3, 4 |
| AC7.1 | Existing tests pass | Yes | Unit + Integration | core.test.ts, session.test.ts, spec.test.ts, property.test.ts | 2-4 |
| AC7.2 | E2E round-trip passes | Yes | Integration + E2E | e2e.test.ts, workers.workers.test.ts | 2, 4 |

---

## Human Verification Checklist

The following criteria require manual verification because they test static module resolution properties of the package, not runtime behavior:

- [ ] **AC1.2**: Confirm `package.json` `exports` has no `"./client"` key after Phase 1 Task 3.
- [ ] **AC1.3**: Confirm `package.json` `exports` has no `"./server"` key after Phase 1 Task 3.
- [ ] **AC1.4**: Confirm `package.json` `exports` has no `"./session"` key after Phase 1 Task 3.

All three can be verified in a single step by inspecting the `exports` field of `package.json` and confirming it contains only the `"."` entry.

---

## Test File Inventory (post-implementation)

| File | Status | Contents |
|------|--------|----------|
| `src/__tests__/core.test.ts` | Unchanged | Type guards, createRequest, RpcError, processRpc, RpcProtocolError |
| `src/__tests__/session.test.ts` | Unchanged | Bidirectional RPC, lifecycle, error resilience |
| `src/__tests__/client.test.ts` | Updated imports + new tests | Auto-batching (renamed), Symbol.dispose tests |
| `src/__tests__/server.test.ts` | Updated imports | HTTP handler (renamed) |
| `src/__tests__/e2e.test.ts` | Updated imports | Client-server round-trip (renamed) |
| `src/__tests__/spec.test.ts` | Updated imports | JSON-RPC spec compliance (renamed) |
| `src/__tests__/property.test.ts` | Updated imports | Property-based tests (import path only) |
| `src/__tests__/websocket.test.ts` | **New** | WebSocket transport, server, client, dispose, queuing |
| `src/__tests__/dispatcher.test.ts` | **New** | Convenience dispatcher routing |
| `src/__tests__/workers.workers.test.ts` | **New** | Workers runtime E2E (all AC re-verified) |
| `src/__tests__/test-helpers.ts` | Unchanged | `createLinkedTransports` helper |
