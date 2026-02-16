# Simplified Exports Implementation Plan — Phase 3

**Goal:** Implement WebSocket server and client functions, plus the convenience dispatcher. Add `@cloudflare/workers-types` for Workers-specific type support.

**Architecture:** Create `src/websocket.ts` with a `WebSocketMessageTransport` adapter that bridges the browser/Workers `WebSocket` API to the existing `RpcMessageTransport` interface, plus server (`newWorkersWebSocketRpcResponse`) and client (`newWebSocketRpcSession`) functions that use `rpcSession` under the hood. Add `newWorkersRpcResponse` convenience dispatcher to `src/index.ts`.

**Tech Stack:** TypeScript 5.x, Cloudflare Workers WebSocket API, @cloudflare/workers-types

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-02-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### simplified-exports.AC1: Single entry point (completed)

- **simplified-exports.AC1.1 Success:** `import { newHttpBatchRpcResponse, newHttpBatchRpcSession, newWorkersWebSocketRpcResponse, newWebSocketRpcSession, newWorkersRpcResponse, RpcError, RpcProtocolError } from "@jmorrell/jsonrpc"` resolves all exports — verified operationally after Task 6 adds WebSocket exports to index.ts (all 7 exports now present)

### simplified-exports.AC4: WebSocket server

- **simplified-exports.AC4.1 Success:** `newWorkersWebSocketRpcResponse` returns 101 Response with WebSocket for upgrade requests
- **simplified-exports.AC4.2 Success:** Server exposes `service` methods callable by client over WebSocket
- **simplified-exports.AC4.3 Success:** `service` parameter is optional (client-only connection)
- **simplified-exports.AC4.4 Failure:** Returns 400 for non-upgrade requests

### simplified-exports.AC5: WebSocket client

- **simplified-exports.AC5.1 Success:** `newWebSocketRpcSession(url)` opens WebSocket connection and returns typed proxy
- **simplified-exports.AC5.2 Success:** `newWebSocketRpcSession(existingWebSocket)` wraps existing WebSocket
- **simplified-exports.AC5.3 Success:** `localFunctions` parameter enables server-to-client calls (bidirectional)
- **simplified-exports.AC5.4 Success:** Messages queued while WebSocket is connecting are delivered after open

### simplified-exports.AC6: Convenience dispatcher

- **simplified-exports.AC6.1 Success:** `newWorkersRpcResponse` routes POST to `newHttpBatchRpcResponse` with CORS header
- **simplified-exports.AC6.2 Success:** `newWorkersRpcResponse` routes `Upgrade: websocket` to `newWorkersWebSocketRpcResponse`
- **simplified-exports.AC6.3 Failure:** Returns 400 for other request types

### simplified-exports.AC3: Disposable return types (WebSocket)

- **simplified-exports.AC3.2 Success:** `newWebSocketRpcSession` return value has `Symbol.dispose` property
- **simplified-exports.AC3.3 Success:** `using session = newWebSocketRpcSession(...)` disposes WebSocket on scope exit

---

<!-- START_TASK_1 -->

### Task 1: Add @cloudflare/workers-types devDependency

**Files:**

- Modify: `package.json` (add devDependency)
- Modify: `tsconfig.json` (add types)

**Step 1: Install the dependency**

```bash
npm install --save-dev @cloudflare/workers-types
```

**Step 2: Add to tsconfig.json types**

Add a `types` field to `compilerOptions` in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "ESNext.Disposable"],
    "types": ["@cloudflare/workers-types"]
  }
}
```

This provides `WebSocketPair`, server-side `WebSocket` with `accept()`, and `Response` constructor with `webSocket` property.

**Note on type interaction:** Adding `"types": ["@cloudflare/workers-types"]` to tsconfig replaces the default `@types/*` automatic inclusion. The `@cloudflare/workers-types` package provides Workers-compatible versions of web API types (`Request`, `Response`, `WebSocket`, etc.) that extend standard DOM types with Workers-specific features (e.g., `Response` constructor accepts `{ webSocket }`, `WebSocket` has `accept()`). Since the existing `"lib": ["ES2022", "DOM"]` also provides web API types, there may be type conflicts. If the build produces duplicate identifier errors, resolve by removing `"DOM"` from `lib` — the workers-types provide equivalent web API definitions that are a superset of DOM. Test that existing HTTP batch code still type-checks after this change.

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds

Run: `npm run test`
Expected: All tests still pass (types addition shouldn't break anything)

**Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: add @cloudflare/workers-types for WebSocket support"
```

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-5) -->
<!-- START_TASK_2 -->

### Task 2: Create createWebSocketTransport in src/websocket.ts

**Files:**

- Create: `src/websocket.ts`

**Implementation:**

Create the `WebSocketMessageTransport` function that adapts the browser/Workers `WebSocket` API to the existing `RpcMessageTransport` interface. This is an internal adapter — not exported from the public API.

Key behaviors:

- **Message routing**: Maps `WebSocket.addEventListener('message', ...)` to `RpcMessageTransport.onMessage`
- **Close handling**: Maps `WebSocket.addEventListener('close', ...)` to `RpcMessageTransport.onClose`
- **Error handling**: Maps `WebSocket.addEventListener('error', ...)` to trigger onClose with error
- **Message queuing**: When WebSocket `readyState` is `CONNECTING` (0), queue messages and flush on `open`
- **Send**: Delegates to `WebSocket.send()`
- **Close**: Delegates to `WebSocket.close()`

```typescript
// src/websocket.ts
import type { RpcMessageTransport, RpcSessionOptions } from "./session.js";
import type { RpcHandlerOptions, PromisifyMethods } from "./core.js";
import { rpcSession } from "./session.js";

/**
 * Adapt a WebSocket to the RpcMessageTransport interface.
 * Handles message queuing while the socket is still connecting.
 */
function createWebSocketTransport(ws: WebSocket): RpcMessageTransport {
  let messageQueue: Array<string> | null = ws.readyState === WebSocket.CONNECTING ? [] : null;

  if (messageQueue) {
    ws.addEventListener("open", () => {
      const queue = messageQueue!;
      messageQueue = null;
      for (const msg of queue) {
        ws.send(msg);
      }
    });
  }

  return {
    send(message: string): void {
      if (messageQueue) {
        messageQueue.push(message);
      } else {
        ws.send(message);
      }
    },
    onMessage(handler: (message: string) => void): void {
      ws.addEventListener("message", (event: MessageEvent) => {
        handler(typeof event.data === "string" ? event.data : String(event.data));
      });
    },
    onClose(handler: (reason?: Error) => void): void {
      ws.addEventListener("close", () => {
        handler();
      });
      ws.addEventListener("error", (event: Event) => {
        handler(new Error("WebSocket error"));
      });
    },
    close(): void {
      ws.close();
    },
  };
}
```

Note: The `open` listener for queue flushing is only added when the WebSocket is in CONNECTING state (client-side `new WebSocket(url)` case). Server-side WebSockets that have already been `accept()`ed are in OPEN state, so no queuing is needed.

**Verification:**

Run: `npm run build`
Expected: Builds successfully

**Commit:** `feat: add createWebSocketTransport adapter`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Implement newWorkersWebSocketRpcResponse

**Files:**

- Modify: `src/websocket.ts` (add function)

**Implementation:**

Add the server-side WebSocket upgrade handler. This function:

1. Checks for `Upgrade: websocket` header — returns 400 if not a WebSocket upgrade request
2. Creates a `WebSocketPair()` — server and client WebSockets
3. Calls `server.accept()` to initiate the connection
4. Creates a `WebSocketMessageTransport` from the server WebSocket
5. Calls `rpcSession()` with the transport as acceptor
6. Returns 101 Response with the client WebSocket

```typescript
/**
 * Handle a WebSocket upgrade request in Cloudflare Workers.
 * Creates a WebSocketPair and starts an RPC session as acceptor.
 */
export function newWorkersWebSocketRpcResponse<TLocal extends object>(
  request: Request,
  service?: TLocal,
  options?: RpcHandlerOptions,
): Response {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  const transport = createWebSocketTransport(server);
  rpcSession(transport, service ?? ({} as TLocal), {
    role: "acceptor",
    onError: options?.onError,
  });

  return new Response(null, { status: 101, webSocket: client });
}
```

Key design decisions:

- `service` is optional (AC4.3) — defaults to empty object for client-only connections
- Uses `"acceptor"` role — the server side of the connection uses negative IDs
- The `rpcSession` return value is NOT exposed — the session lives as long as the WebSocket
- Returns a standard Workers 101 Response with the client WebSocket attached

**Verification:**

Run: `npm run build`
Expected: Builds successfully

**Commit:** `feat: add newWorkersWebSocketRpcResponse`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Implement newWebSocketRpcSession

**Files:**

- Modify: `src/websocket.ts` (add function)

**Implementation:**

Add the client-side WebSocket session function. This function:

1. Accepts either a `WebSocket` instance or a `string` URL
2. If string URL: creates `new WebSocket(url)` — transport queues messages until open
3. Creates a `WebSocketMessageTransport` from the WebSocket
4. Calls `rpcSession()` with the transport as initiator
5. Returns a typed Proxy (`PromisifyMethods<T> & Disposable`) where:
   - Method calls dispatch RPC via the session's `remote` proxy
   - `Symbol.dispose` closes the WebSocket and cleans up the session

```typescript
type WebSocketRpcSessionOptions = {
  onError?: RpcHandlerOptions["onError"];
};

/**
 * Create a WebSocket RPC client session.
 * Accepts a WebSocket URL (string) or an existing WebSocket instance.
 */
export function newWebSocketRpcSession<
  TRemote extends object,
  TLocal extends object = Record<string, never>,
>(
  ws: WebSocket | string,
  localFunctions?: TLocal,
  options?: WebSocketRpcSessionOptions,
): PromisifyMethods<TRemote> & Disposable & { close(): void } {
  const socket = typeof ws === "string" ? new WebSocket(ws) : ws;
  const transport = createWebSocketTransport(socket);

  const session = rpcSession<TRemote, TLocal>(transport, localFunctions ?? ({} as TLocal), {
    role: "initiator",
    onError: options?.onError,
  });

  const RESERVED_PROPS = new Set(["then", "toJSON"]);

  return new Proxy({} as PromisifyMethods<TRemote> & Disposable & { close(): void }, {
    get(_target, prop) {
      if (prop === Symbol.dispose) {
        return () => session.close();
      }
      if (prop === "close") {
        return () => session.close();
      }
      if (typeof prop === "symbol") return undefined;
      if (RESERVED_PROPS.has(prop as string)) return undefined;

      return (session.remote as Record<string, unknown>)[prop];
    },
  });
}
```

Key design decisions:

- `ws: WebSocket | string` — accepts both URL and existing WebSocket (AC5.1, AC5.2)
- `localFunctions` optional — enables bidirectional calls when provided (AC5.3)
- Message queuing handled by `createWebSocketTransport` (AC5.4)
- Uses `"initiator"` role — client side uses positive IDs
- `Symbol.dispose` calls `session.close()` which closes transport and rejects pending calls
- `close()` also calls `session.close()` — per the design plan (line 66: "Returns a typed proxy with `close()` attached", lines 71-77 show `api.close()`)
- The outer Proxy delegates method access to `session.remote`, adding `Symbol.dispose` and `close()` on top
- Return type is `PromisifyMethods<T> & Disposable & { close(): void }` (AC3.2 + design plan)

**Verification:**

Run: `npm run build`
Expected: Builds successfully

**Commit:** `feat: add newWebSocketRpcSession`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: WebSocket function tests

**Verifies:** simplified-exports.AC4.1, simplified-exports.AC4.2, simplified-exports.AC4.3, simplified-exports.AC4.4, simplified-exports.AC5.1, simplified-exports.AC5.2, simplified-exports.AC5.3, simplified-exports.AC5.4, simplified-exports.AC3.2, simplified-exports.AC3.3

**Files:**

- Create: `src/__tests__/websocket.test.ts`

**Testing:**

Tests must verify each AC listed above:

- simplified-exports.AC4.1: `newWorkersWebSocketRpcResponse` with upgrade header returns Response with status 101 and has a `webSocket` property
- simplified-exports.AC4.2: Server exposes service methods — create WebSocketPair manually, connect both sides, call method via client session, verify result
- simplified-exports.AC4.3: `service` parameter omitted or `undefined` — function succeeds, returns 101
- simplified-exports.AC4.4: Request without `Upgrade: websocket` header returns 400
- simplified-exports.AC5.1: `newWebSocketRpcSession(url)` — tested via WebSocketPair (pass one side as "existing WebSocket")
- simplified-exports.AC5.2: `newWebSocketRpcSession(existingWebSocket)` — pass an already-open WebSocket, verify RPC works
- simplified-exports.AC5.3: `localFunctions` parameter — create bidirectional setup, verify server can call client functions
- simplified-exports.AC5.4: Messages queued while connecting — this requires a WebSocket in CONNECTING state, may need to test at transport adapter level
- simplified-exports.AC3.2: Return value of `newWebSocketRpcSession` has `Symbol.dispose` property
- simplified-exports.AC3.3: Calling `[Symbol.dispose]()` closes the WebSocket
- Design plan `close()`: Return value has `close()` method that closes the WebSocket (design plan line 66)

**Testing approach and mock strategy:**

Since these tests run in Vitest (Node environment, not Workers runtime), they cannot use real `WebSocketPair()`. Use these patterns:

**1. Mock WebSocket class for `createWebSocketTransport` and `newWebSocketRpcSession` tests:**

```typescript
class MockWebSocket {
  readyState = WebSocket.OPEN; // or CONNECTING for queue tests
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    // Capture sent messages for assertions
  }

  close(): void {
    // Trigger close listeners
    for (const handler of this.listeners.get("close") ?? []) {
      handler(new CloseEvent("close"));
    }
  }

  // Test helper: simulate incoming message
  _receiveMessage(data: string): void {
    for (const handler of this.listeners.get("message") ?? []) {
      handler(new MessageEvent("message", { data }));
    }
  }
}
```

**2. For `newWorkersWebSocketRpcResponse` tests:** Use `vi.stubGlobal("WebSocketPair", MockWebSocketPair)` where `MockWebSocketPair` returns a pair of linked `MockWebSocket` instances. Alternatively, test this function primarily in Phase 4 Workers runtime tests where real `WebSocketPair` is available, and only test the 400 rejection path in unit tests.

**3. For bidirectional RPC tests (AC5.3):** Use the linked transport pattern from `test-helpers.ts` (existing `createLinkedPair()`) to test the `rpcSession` integration without WebSocket mocking. This tests the session layer directly.

**4. For message queuing tests (AC5.4):** Create a `MockWebSocket` with `readyState = 0` (CONNECTING), call `send()` to queue messages, then fire the `open` event and verify queued messages are sent.

Full Workers runtime integration tests come in Phase 4.

Follow existing test patterns from `session.test.ts` for bidirectional RPC testing.

**Verification:**

Run: `npm run test`
Expected: All tests pass (existing + new)

**Commit:** `test: add WebSocket function tests`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 6-7) -->
<!-- START_TASK_6 -->

### Task 6: Implement newWorkersRpcResponse convenience dispatcher

**Files:**

- Modify: `src/index.ts` (add function and re-exports)

**Implementation:**

Add the convenience dispatcher function to `src/index.ts`. This function routes requests based on HTTP method and upgrade headers:

1. `Upgrade: websocket` header → delegate to `newWorkersWebSocketRpcResponse`
2. `POST` method → delegate to `newHttpBatchRpcResponse` with CORS header `Access-Control-Allow-Origin: *`
3. Everything else → return 400

Also add re-exports from `websocket.ts` to the index.

```typescript
// Add to src/index.ts

// WebSocket transport
export { newWorkersWebSocketRpcResponse, newWebSocketRpcSession } from "./websocket.js";

// Convenience dispatcher
import { newHttpBatchRpcResponse } from "./http-batch.js";
import { newWorkersWebSocketRpcResponse } from "./websocket.js";
import type { RpcHandlerOptions } from "./core.js";

/**
 * Convenience dispatcher for Cloudflare Workers.
 * Routes POST → HTTP batch (with CORS), Upgrade → WebSocket, else → 400.
 */
export async function newWorkersRpcResponse<T extends object>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions,
): Promise<Response> {
  // WebSocket upgrade
  if (request.headers.get("Upgrade") === "websocket") {
    return newWorkersWebSocketRpcResponse(request, service, options);
  }

  // HTTP POST → batch with CORS
  if (request.method === "POST") {
    const response = await newHttpBatchRpcResponse(request, service, options);
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Anything else → 400
  return new Response("Bad Request", { status: 400 });
}
```

**Verification:**

Run: `npm run build`
Expected: Builds successfully

**Commit:** `feat: add newWorkersRpcResponse convenience dispatcher`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->

### Task 7: Convenience dispatcher tests

**Verifies:** simplified-exports.AC6.1, simplified-exports.AC6.2, simplified-exports.AC6.3

**Files:**

- Create or modify: `src/__tests__/dispatcher.test.ts` (or add to an existing test file)

**Testing:**

Tests must verify:

- simplified-exports.AC6.1: POST request → delegates to `newHttpBatchRpcResponse`, response has `Access-Control-Allow-Origin: *` header
- simplified-exports.AC6.2: Request with `Upgrade: websocket` header → delegates to `newWorkersWebSocketRpcResponse`, returns 101
- simplified-exports.AC6.3: GET request without upgrade header → returns 400

Test the dispatcher by calling `newWorkersRpcResponse` with appropriate Request objects and checking the Response status and headers.

For the WebSocket path test: This requires `WebSocketPair` which is Workers-only. In a Vitest (non-Workers) environment, this may need mocking or can be deferred to Phase 4 workers runtime tests. Test the POST and 400 paths in unit tests.

**Verification:**

Run: `npm run test`
Expected: All tests pass

**Commit:** `test: add convenience dispatcher tests`

<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_8 -->

### Task 8: Update AGENTS.md for WebSocket additions

**Files:**

- Modify: `AGENTS.md`

**Implementation:**

Add `src/websocket.ts` to the Project Structure section:

```
- `src/websocket.ts` - WebSocket transport: newWorkersWebSocketRpcResponse (server) + newWebSocketRpcSession (client with Disposable proxy)
```

Update the Package Entry Points section to include WebSocket exports:

```
Single public entry point via index.ts:

- `@jmorrell/jsonrpc` - newHttpBatchRpcResponse, newHttpBatchRpcSession, newWorkersWebSocketRpcResponse, newWebSocketRpcSession, newWorkersRpcResponse, RpcError, RpcProtocolError
```

Update Module Dependency Rules:

```
- websocket.ts: imports from core.ts and session.ts
```

**Verification:**

Review AGENTS.md for accuracy.

**Commit:** `docs: update AGENTS.md for WebSocket additions`

<!-- END_TASK_8 -->

<!-- START_TASK_9 -->

### Task 9: Verify all tests and build pass

**Files:** None (verification only)

**Step 1: Run the full test suite**

Run: `npm run test`
Expected: All tests pass (134 existing + new WebSocket and dispatcher tests)

**Step 2: Run the build**

Run: `npm run build`
Expected: Build succeeds, `dist/websocket.js` and `dist/websocket.d.ts` generated

**Step 3: Verify exports**

Check that `dist/index.d.ts` exports all 5 public functions and both error classes.

<!-- END_TASK_9 -->
