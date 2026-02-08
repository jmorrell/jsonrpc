# @jmorrell/jsonrpc — Implementation Plan

## Context

We're building a lightweight, spec-compliant JSON-RPC 2.0 library for TypeScript, designed for Cloudflare Workers. Key inspirations:

- **typed-rpc**: Minimal approach — single `client.ts`, single `server.ts`, zero deps, Proxy-based typed client. We adopt this overall shape.
- **capnweb**: Batch mechanism — calls made in the same event loop turn are automatically grouped into one HTTP request. We adopt this auto-batching pattern (but not promise pipelining or object capabilities).

The library uses TypeScript interfaces for service definitions (no codegen). A service is defined once as a TS interface, the server implements it as a class/object, and the client gets full type inference via `rpcClient<MyService>(url)`.

## Design Decisions

| Decision | Choice |
|---|---|
| Batch API | Implicit auto-batching via `setTimeout(0)` — all calls in the same event loop turn batch together |
| Pipelining | No. Batch calls are independent. |
| Notifications | Yes. `client.notify.method(...)` syntax, returns `Promise<void>` (resolves on send, rejects on transport error). `notify` is a reserved name. |
| Server shape | Plain object/class instance, no context injection into methods |
| Server I/O | `handleRpc(request: Request, service): Promise<Response>`. Handles body reading, JSON parsing, -32700, status codes, Content-Type. |
| Package name | `@jmorrell/jsonrpc` |
| Dependencies | Zero runtime dependencies |
| Params style | By-position (arrays) on both client and server. Named params (objects) rejected with -32602 Invalid params. |

## File Structure

```
src/
  types.ts      — JSON-RPC 2.0 type definitions
  client.ts     — rpcClient(), RpcError, batch transport
  server.ts     — handleRpc(), validation, error handling
```

Three files. That's it.

## API Design

### types.ts

```ts
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown[];  // by-position only; named params rejected with -32602
}

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
```

### client.ts

```ts
const client = rpcClient<MyService>("https://example.com/api");

// Single call (if no other calls in same turn, sent as single object, not array):
const result = await client.add(1, 2);

// Multiple calls made synchronously → one HTTP request with batch array:
const [a, b, c] = await Promise.all([
  client.add(1, 2),
  client.subtract(5, 3),
  client.multiply(2, 4),
]);

// Notifications (fire-and-forget, no response expected):
client.notify.logEvent("page_viewed", { page: "/home" });

// With options:
const client = rpcClient<MyService>({
  url: "https://example.com/api",
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),        // sync
  getHeaders: async () => ({ Authorization: `Bearer ${token}` }),   // or async
});
```

**How auto-batching works:**

1. `rpcClient` returns a Proxy. Each method call creates a `JsonRpcRequest` and appends it to a pending batch array.
2. On the first call, a `setTimeout(0)` is scheduled to flush the batch. Since `setTimeout(0)` schedules a macrotask, all synchronous calls AND microtask-scheduled calls (`.then()`, `queueMicrotask`) within the same event loop turn are included in the batch. The batch flushes when the macrotask queue is reached.
3. When the timeout fires:
   - If exactly 1 item is queued → sent as a single JSON-RPC request object (not an array). Compatible with servers that don't support batching.
   - If 2+ items are queued → sent as a JSON-RPC batch array.
4. Responses are matched to pending promises by `id`.
5. If `fetch` fails (network error, non-2xx, or body is not valid JSON), ALL pending promises in that batch reject.
   - If a batch was sent but the server returns a single JSON-RPC error object (not an array) — e.g. for parse errors — all pending promises reject with that error.
6. If the server returns fewer responses than expected, promises with no matching response reject with an error.
7. Responses with unrecognized IDs are silently ignored.

**Request IDs:** Auto-incrementing integers starting from 1, scoped to the client instance.

**Notifications:**
- `client.notify` returns a Proxy that creates requests without an `id` field.
- Returns `Promise<void>` — resolves when the batch containing the notification is successfully sent (HTTP 2xx). Rejects on transport errors (network failure, non-2xx). No JSON-RPC response is expected from the server for notifications.

**Reserved property names:** `then`, `toJSON`, `notify` — these cannot be used as RPC method names on the client.

### server.ts

```ts
// Takes a Request, returns a Response. Handles everything.
const response = await handleRpc(request, service);

// Usage in Cloudflare Worker:
export default {
  async fetch(req: Request) {
    return handleRpc(req, myService);
  }
};

// With options:
return handleRpc(req, myService, {
  onError: (err) => console.error(err),
});
```

**`handleRpc` signature:**
```ts
function handleRpc<T>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions
): Promise<Response>
```

**`handleRpc` behavior:**

1. Check HTTP method. If not POST → respond 405 with `Allow: POST` header.
2. Read body as text from the `Request`.
3. Parse JSON. If parse fails → respond 200 with `{ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }`.
4. If parsed value is neither an object nor an array (e.g. a JSON primitive) → respond 200 with Invalid Request error, `id: null`.
5. If parsed value is an empty array → respond 200 with Invalid Request error, `id: null`.
6. If parsed value is an object → process as single request, respond 200 with single JSON-RPC response.
7. If parsed value is a non-empty array → process as batch:
   - Each item is processed independently. An exception in one handler MUST NOT affect others. (Per-item try/catch, NOT `Promise.all` over raw invocations.)
   - Non-object items in the array (numbers, strings, etc.) → Invalid Request error with `id: null`.
   - Invalid request objects → Invalid Request error, `id` from request if detectable, else `null`.
   - Notifications (requests without `id`) are executed but produce no response entry.
   - Responses are collected into an array.
   - If all items were notifications (response array is empty) → respond 204 (no body).
   - Otherwise → respond 200 with JSON array of responses.
8. Process batch items concurrently with `Promise.allSettled` (error isolation).
9. Requests for methods starting with `rpc.` → reject with Method not found (-32601).
10. When generating error responses for requests where the `id` could not be detected, the response `id` MUST be `null`.
11. All JSON responses use `Content-Type: application/json`.

## Implementation Order

### Phase 1: Project Setup & Types
1. Set up project (tsconfig, package.json, vitest config)
2. Write `types.ts` with all JSON-RPC 2.0 types
3. Write type-level client types (`Promisify`, `PromisifyMethods`, client options)
4. Write type-level server types (`RpcHandlerOptions`)

### Phase 2: Test Suite (tests BEFORE implementation)
5. **server unit tests:**
   - `isJsonRpcRequest` validation (valid requests, missing fields, wrong types)
   - `handleRpc` with invalid JSON body (→ -32700 Parse error, 200 status)
   - `handleRpc` single requests: success, method not found, error in handler
   - `handleRpc` error extraction (code, message, data from thrown errors)
   - Reserved `rpc.` method rejection
   - Primitives as body (string, number, bool, null JSON) → Invalid Request
   - Response has correct Content-Type: application/json
   - Non-POST requests → 405 with Allow: POST header
6. **server batch tests:**
   - Array of valid requests → array of responses
   - Mixed requests and notifications → responses only for non-notifications
   - Empty array → single Invalid Request error
   - Array with non-object items (`[1, 2, 3]`) → array of Invalid Request errors
   - Mixed valid + invalid items in batch
   - All-notification batch → 204 response with no body
   - Error isolation: one handler throws, others succeed
   - Concurrent execution (handlers run in parallel)
7. **client unit tests:**
   - `isJsonRpcResponse` validation
   - `createRequest` format and ID generation (auto-increment integers)
   - Single call sends single object (not array)
   - Notification request has no `id` field
8. **client batching tests (mock fetch):**
   - Two synchronous calls → one fetch with array of 2
   - Two `await`-separated calls → two separate fetches
   - Response dispatch: correct result to correct promise by ID
   - Batch with mixed successes and errors: successful promises resolve, failed ones reject
   - Fetch failure → all promises in batch reject
   - Server returns fewer responses than requests → unmatched promises reject
   - Server returns unrecognized IDs → silently ignored
   - Server returns single error object for a batch → all promises reject
   - Single call + notification in same tick → batch (array of 2)
   - `notify` returns Promise<void> that resolves on successful send, rejects on transport error
9. **e2e tests:**
   - Client→server round trip: single call
   - Client→server round trip: batch of 3 calls
   - Client→server: notifications (server executes, no response)
   - Client→server: error propagation (server throws → client gets RpcError)
   - Client→server: batch with mixed success/error
10. **spec compliance tests:**
    - All predefined error codes (-32700, -32600, -32601, -32602, -32603)
    - ID types: string, number, null
    - Response id is null when request id undetectable
    - Spec examples from specification.md reproduced as tests
11. **property-based tests (fast-check):**
    - Any valid JsonRpcRequest produces a valid JsonRpcResponse
    - Batch of N non-notification requests → exactly N responses
    - Response IDs always match request IDs
    - Error responses always have valid error objects

### Phase 3: Server Implementation
12. Implement `isJsonRpcRequest` type guard
13. Implement `handleRpc` for single requests (Request → read body → parse → validate → dispatch → Response)
14. Extend `handleRpc` for batch support (array input, `Promise.allSettled`, error isolation)
15. Implement notification handling (no response for id-less requests)
16. Implement all spec-required error responses

### Phase 4: Client Implementation
17. Implement `createRequest`, `isJsonRpcResponse`, `RpcError`
18. Implement Proxy-based client with auto-batching (`setTimeout(0)` flush)
19. Implement response dispatch (match by ID, handle missing responses, ignore unknown IDs)
20. Implement `notify` proxy
21. Implement fetch error handling (network failures → reject all batch promises)

### Phase 5: Polish
22. Package exports configuration (`./client` and `./server` entry points)
23. Final pass on any remaining edge cases from test failures

## Testing Strategy

**Framework:** vitest (fast, TS-native, works in Workers)
**Property testing:** fast-check

**Test structure:**
```
src/
  __tests__/
    server.test.ts       — server unit + batch tests
    client.test.ts       — client unit + batch tests
    e2e.test.ts          — full round-trip tests
    spec.test.ts         — spec compliance tests
    property.test.ts     — property-based / fuzz tests
```

**E2E approach:** Use a simple in-memory transport (function that calls handleRpc directly) for integration tests. Use a real HTTP server (node built-in or vitest's) for true e2e tests.

## Key Files to Reference During Implementation

- `repos/typed-rpc/src/client.ts` — Proxy pattern, `createRequest`, `isJsonRpcResponse`, `RpcError`, `fetchTransport`
- `repos/typed-rpc/src/server.ts` — `handleRpc`, `isJsonRpcRequest`, error extraction
- `repos/typed-rpc/src/types.ts` — Wire format types
- `repos/capnweb/src/batch.ts` — `BatchClientTransport` (`setTimeout(0)` batching pattern)
- `specification.md` — JSON-RPC 2.0 spec
- `/Users/jeremymorrell/workspace/stacks/app/src/magpie-service.ts` — Example service interface pattern (TS interface)
- `/Users/jeremymorrell/workspace/stacks/app/src/server/lib/api/jsonrpc.ts` — Example service class pattern (class implements interface, context via constructor)

## Verification

1. `npm test` — all tests pass
2. E2E: client makes single + batch + notification calls through real HTTP
3. Verify: batch of 3 calls = exactly 1 HTTP request containing a 3-element array
4. Verify: single call = 1 HTTP request containing a plain object (not array)
5. Spec compliance: every error code scenario from spec has a passing test
6. Property tests: no failures after 1000+ runs
