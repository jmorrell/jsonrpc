# Bidirectional RPC Implementation Plan - Phase 2: Remove Notifications

**Goal:** Remove the notification concept from the library. Every client call becomes a tracked method call. The server detects incoming notifications and ignores them (does not execute handlers), logging a warning via `onError`.

**Architecture:** Remove `.notify` proxy and related plumbing from the client. Simplify `RpcClient<T>` to `PromisifyMethods<T>`. Modify `processSingleRequest` in `core.ts` to short-circuit notifications without executing the handler.

**Tech Stack:** TypeScript, Vitest

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bidi-rpc.AC1: Notifications removed
- **bidi-rpc.AC1.1 Success:** Client proxy has no `.notify` property — accessing it returns `undefined`
- **bidi-rpc.AC1.2 Success:** `RpcClient<T>` type is equivalent to `PromisifyMethods<T>` (no notify member)
- **bidi-rpc.AC1.3 Success:** Void-returning methods return `Promise<void>` that resolves when the server processes the call (response has `result: null`)
- **bidi-rpc.AC1.4 Success:** Server detects incoming notification (`!("id" in body)`) and returns `null` without executing the method handler
- **bidi-rpc.AC1.5 Success:** Server logs incoming notification via `onError` callback
- **bidi-rpc.AC1.6 Edge:** Batch containing mix of requests and notifications: requests produce responses, notifications are ignored, notification handlers are not executed

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Server-side notification changes + server test updates

**Verifies:** bidi-rpc.AC1.4, bidi-rpc.AC1.5, bidi-rpc.AC1.6

**Files:**
- Modify: `src/core.ts` (the `processSingleRequest` function, moved here in Phase 1)
- Modify: `src/__tests__/server.test.ts`

**Implementation:**

Modify `processSingleRequest` in `src/core.ts` to detect notifications early and return `null` without executing the method handler. Add `onError` logging.

Change the function so that immediately after validation (`isJsonRpcRequest` check), if the request is a notification, log a warning and return `null`:

```typescript
async function processSingleRequest(
  body: unknown,
  service: any,
  options?: RpcHandlerOptions
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(body)) {
    return errorResponse(null, -32600, "Invalid Request");
  }

  const isNotification = !("id" in body);

  // Notifications are not supported — ignore without executing
  if (isNotification) {
    options?.onError?.(
      new Error(`Received JSON-RPC notification for method "${body.method}" — notifications are not supported`)
    );
    return null;
  }

  const id = body.id ?? null;
  const { method, params } = body;

  // Reject rpc.-prefixed methods (spec-reserved)
  if (method.startsWith("rpc.")) {
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject Object.prototype methods (security)
  if (method in Object.prototype) {
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject non-function service properties
  if (typeof service[method] !== "function") {
    return errorResponse(id, -32601, "Method not found");
  }

  try {
    const result = await service[method](...(params ?? []));
    return successResponse(id, result);
  } catch (err) {
    options?.onError?.(err);
    const { code, message, data } = extractError(err);
    return errorResponse(id, code, message, data);
  }
}
```

Key changes from the current implementation:
- The notification check moves to the top, before any method lookup or execution
- All `if (isNotification) return null;` guards sprinkled through the function are removed
- A warning is logged via `onError` when a notification is received
- The `id` variable no longer needs the ternary — it's always from a non-notification request

**Then update `src/__tests__/server.test.ts`** to match new behavior:

1. **Update test** "returns null for a notification (no id member)" (lines 314-323):
   - Keep the assertion that result is `null`
   - Change to verify handler is **NOT** called: `expect(fn).not.toHaveBeenCalled();`

2. **Remove test** "still executes method for notifications even if it throws" (lines 337-348) — no longer applicable since handler isn't executed

3. **Update test** "returns 204 for notification" (lines 385-395):
   - Keep the assertion that status is 204
   - Change to verify handler is **NOT** called: `expect(fn).not.toHaveBeenCalled();`

4. **Update test** "returns responses only for non-notifications in mixed batch" (lines 431-447):
   - Keep the assertions about response content (2 responses for 2 requests)
   - Change to verify notification handler is **NOT** called: `expect(fn).not.toHaveBeenCalled();`

5. **Update test** "returns null for all-notification batch" (lines 483-497):
   - Keep the assertion that result is `null`
   - Change to verify handlers are **NOT** called: `expect(fn1).not.toHaveBeenCalled();` and `expect(fn2).not.toHaveBeenCalled();`

6. **Add new test** "logs warning via onError when notification received":
   ```typescript
   it("logs warning via onError when notification received", async () => {
     const onError = vi.fn();
     const fn = vi.fn();
     const svc = { doStuff: fn };
     await processRpc(
       { jsonrpc: "2.0", method: "doStuff", params: [1] },
       svc,
       { onError }
     );
     expect(fn).not.toHaveBeenCalled();
     expect(onError).toHaveBeenCalledOnce();
     expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
     expect(onError.mock.calls[0][0].message).toContain("notification");
   });
   ```

7. **Add new test** for AC1.6 — batch with mixed requests and notifications, notification handlers not executed:
   ```typescript
   it("batch: requests produce responses, notification handlers not executed", async () => {
     const notifyFn = vi.fn();
     const svc = { ...service, logEvent: notifyFn };
     const result = await processRpc(
       [
         { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
         { jsonrpc: "2.0", method: "logEvent", params: ["test"] },
         { jsonrpc: "2.0", id: 2, method: "subtract", params: [5, 3] },
       ],
       svc
     );
     expect(result).toEqual([
       { jsonrpc: "2.0", id: 1, result: 3 },
       { jsonrpc: "2.0", id: 2, result: 2 },
     ]);
     expect(notifyFn).not.toHaveBeenCalled();
   });
   ```

**Verification:**

Run: `npm run test`
Expected: All tests pass (server tests updated to match new behavior; client, e2e, spec, and property tests are unaffected by server-side changes)

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `feat: ignore incoming notifications without executing handlers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Client-side notification removal + type changes + client test updates

**Verifies:** bidi-rpc.AC1.1, bidi-rpc.AC1.2

**Files:**
- Modify: `src/types.ts:29-61`
- Modify: `src/client.ts:106-294`
- Modify: `src/__tests__/client.test.ts`

**Implementation:**

**In `src/types.ts`:**

1. Add `export` to the `PromisifyMethods` type at line 35:
   ```typescript
   export type PromisifyMethods<T extends object> = {
     [K in keyof T]: Promisify<T[K]>;
   };
   ```

2. Replace the `RpcClient<T>` type (lines 55-61) with:
   ```typescript
   export type RpcClient<T extends object> = PromisifyMethods<T>;
   ```

This removes the `notify` member from the type entirely.

**In `src/client.ts`:**

Remove all notification-related code:

1. **Delete `PendingNotification` type** (lines 112-115)

2. **Remove "notify" from `RESERVED_PROPS`** (line 117). Change to:
   ```typescript
   const RESERVED_PROPS = new Set(["then", "toJSON"]);
   ```

3. **Delete `pendingNotifications` variable** (line 137)

4. **Simplify `flush()` function** — remove notification handling:
   - Remove `const notifications = pendingNotifications;` (line 151)
   - Remove `pendingNotifications = [];` (line 154)
   - Remove the empty response block (lines 169-174 that checks `!responseText` and resolves notifications)
   - Remove the `for (const n of notifications) { n.resolve(); }` block after parsing (lines 179-181)
   - Remove the notification rejection in the catch block (lines 248-250)
   - Change `isSingleRequest` check (line 160) to just: `const isSingleRequest = requests.length === 1;`

5. **Delete the entire `notifyProxy`** (lines 254-271)

6. **Remove the `notify` case from main proxy** (line 280). Delete: `if (prop === "notify") return notifyProxy;`

7. **Fix the return type cast** (line 293). Change from `as RpcClient<T>` to match the new simplified type (still `as RpcClient<T>` since the type is now just `PromisifyMethods<T>`).

**Then update `src/__tests__/client.test.ts`:**

1. **Remove test** "single call + notification in same tick → batch array" (lines 306-340) — this tests `.notify` which no longer exists
2. **Remove test** "notify returns Promise<void> that resolves on send" (lines 342-350) — tests removed feature
3. **Remove test** "notify rejects on transport error" (lines 352-361) — tests removed feature
4. **Keep test** "creates notification (no id) when id generator returns undefined" (lines 105-110) — `createRequest` still supports creating requests without IDs. This tests `createRequest`, not the client proxy.
5. **Add new test** "accessing .notify on client returns undefined":
   ```typescript
   it("accessing .notify on client returns undefined", async () => {
     const { transport } = mockTransport();
     type Svc = { add(a: number, b: number): number };
     const client = rpcClient<Svc>({ transport });
     expect((client as any).notify).toBeUndefined();
   });
   ```

**Verification:**

Run: `npm run test`
Expected: All tests pass

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `refactor: remove notification plumbing from client`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: E2e and spec test updates + final verification

**Verifies:** bidi-rpc.AC1.1, bidi-rpc.AC1.3, bidi-rpc.AC1.4, bidi-rpc.AC1.5, bidi-rpc.AC1.6

**Files:**
- Modify: `src/__tests__/e2e.test.ts`
- Modify: `src/__tests__/spec.test.ts`
- Review: `src/__tests__/property.test.ts` (verify no changes needed)

**Implementation:**

**`src/__tests__/e2e.test.ts`:**

1. **Remove test** "notifications: server executes, no response expected" (lines 62-69) — uses `.notify`
2. **Remove the entire** "e2e: client → handleRpc (HTTP transport)" describe block (lines 122-143) — both tests use `.notify`
3. **Remove** the `createHttpTransport` helper (lines 110-120) — only used by the removed HTTP transport tests
4. **Add new test** for void-returning methods (AC1.3). Note: the `CalcService` interface already includes `logEvent(event: string): void` and `calcService` already implements it as `vi.fn()`:
   ```typescript
   it("void-returning method resolves Promise<void>", async () => {
     const logFn = vi.fn();
     const svc = { ...calcService, logEvent: logFn };
     const transport = createInMemoryTransport(svc);
     type Svc = typeof calcService;
     const client = rpcClient<Svc>({ transport });
     await client.logEvent("page_view");
     expect(logFn).toHaveBeenCalledWith("page_view");
   });
   ```

**`src/__tests__/spec.test.ts`:**

1. **Update stale comment** at line 180. Change:
   ```
   // foobar exists, so it executes and returns null
   ```
   to:
   ```
   // notification — ignored without executing, returns null
   ```

2. The remaining spec tests ("notification: no response", "batch: spec example", "batch: all notifications") check return values not handler execution — they pass as-is.

**`src/__tests__/property.test.ts`:**

No changes needed. All property test requests include `id` fields, so they are not affected by the notification behavior change. Verify by running tests.

**Verification:**

Run: `npm run test`
Expected: All tests pass

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `test: update e2e and spec tests for notification removal`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final verification and cleanup

**Verifies:** bidi-rpc.AC1.1, bidi-rpc.AC1.2, bidi-rpc.AC1.3

**Files:**
- Review: `src/types.ts`, `src/client.ts`, `src/core.ts`
- Modify: `src/client.ts` (if needed — remove dead code)

**Implementation:**

Verify these invariants hold:

1. `RpcClient<T>` is now equivalent to `PromisifyMethods<T>` — no `notify` member
2. The client proxy returns `undefined` for `.notify` access
3. `RESERVED_PROPS` no longer contains `"notify"`
4. No references to `PendingNotification`, `notifyProxy`, or `pendingNotifications` remain in client.ts
5. `processSingleRequest` does not execute the method handler for notifications
6. `processSingleRequest` logs via `onError` for incoming notifications
7. `PromisifyMethods` is exported from `types.ts` (needed for session types in Phase 3)

Check for any dead imports or unused variables. Clean up if needed.

**Verification:**

Run: `npm run test`
Expected: All tests pass

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `chore: clean up after notification removal`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
