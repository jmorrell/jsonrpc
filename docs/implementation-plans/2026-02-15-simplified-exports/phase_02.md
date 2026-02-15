# Simplified Exports Implementation Plan — Phase 2

**Goal:** Add `Symbol.dispose` to HTTP batch session proxy. Update all existing tests to use new imports and function names.

**Architecture:** Extend the Proxy `get` trap in `newHttpBatchRpcSession` to handle `Symbol.dispose`. Update tsconfig to include `esnext.disposable` lib. Rename test references from old function names to new ones.

**Tech Stack:** TypeScript 5.x (with `esnext.disposable` lib), Vitest, fast-check

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-02-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### simplified-exports.AC2: HTTP batch functions (capnweb-compatible)
- **simplified-exports.AC2.1 Success:** `newHttpBatchRpcResponse` handles POST request and returns JSON-RPC response
- **simplified-exports.AC2.2 Success:** `newHttpBatchRpcSession` creates auto-batching client proxy, concurrent calls batched in single request
- **simplified-exports.AC2.3 Failure:** `newHttpBatchRpcResponse` returns 405 for non-POST requests
- **simplified-exports.AC2.4 Failure:** `newHttpBatchRpcSession` propagates server errors as `RpcError`

### simplified-exports.AC3: Disposable return types
- **simplified-exports.AC3.1 Success:** `newHttpBatchRpcSession` return value has `Symbol.dispose` property
- **simplified-exports.AC3.4 Success:** `Symbol.dispose` is non-enumerable (doesn't interfere with object comparison)

---

<!-- START_TASK_1 -->
### Task 1: Add esnext.disposable to tsconfig.json

**Files:**
- Modify: `tsconfig.json` (line 12, the `lib` field)

**Step 1: Update the lib field**

Change line 12 from:
```json
"lib": ["ES2022", "DOM"]
```
to:
```json
"lib": ["ES2022", "DOM", "ESNext.Disposable"]
```

This adds the `Disposable` and `AsyncDisposable` interfaces plus `Symbol.dispose` type definitions to the project.

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add ESNext.Disposable lib for Symbol.dispose support"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->
<!-- START_TASK_2 -->
### Task 2: Add Symbol.dispose to newHttpBatchRpcSession proxy

**Verifies:** simplified-exports.AC3.1, simplified-exports.AC3.4

**Files:**
- Modify: `src/http-batch.ts` (the Proxy `get` trap at the end of `newHttpBatchRpcSession`)

**Implementation:**

In `newHttpBatchRpcSession`, modify the Proxy `get` trap to handle `Symbol.dispose`. The HTTP batch client has no persistent connection, so dispose is a no-op. The key requirement is that `Symbol.dispose` is present and non-enumerable (Proxy `get` trap naturally provides this — symbol properties accessed via `get` don't appear in `Object.keys()` or spread).

Change the return type from `PromisifyMethods<T>` to `PromisifyMethods<T> & Disposable`.

In the Proxy `get` trap, before the `typeof prop === "symbol"` check, add:
```typescript
if (prop === Symbol.dispose) {
  return () => {};
}
```

The existing `typeof prop === "symbol"` guard (which returns `undefined` for all symbols) must be moved AFTER the `Symbol.dispose` check. The updated trap logic should be:

```typescript
get(_target, prop) {
  if (prop === Symbol.dispose) {
    return () => {};
  }
  if (typeof prop === "symbol") return undefined;
  if (RESERVED_PROPS.has(prop as string)) return undefined;
  if (prop === "notify") return undefined;

  return (...args: unknown[]) => {
    // ... existing call logic unchanged
  };
},
```

Also update the function's return type annotation and the cast at the end:
```typescript
export function newHttpBatchRpcSession<T extends object>(options: RpcClientOptions): PromisifyMethods<T> & Disposable {
  // ... existing code ...
  return new Proxy(/* ... */) as PromisifyMethods<T> & Disposable;
}
```

**Verification:**

Run: `npm run build`
Expected: Build succeeds

**Commit:** `feat: add Symbol.dispose to HTTP batch session proxy`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update client.test.ts imports and function names

**Verifies:** simplified-exports.AC2.2, simplified-exports.AC2.4

**Files:**
- Modify: `src/__tests__/client.test.ts`

**Implementation:**

Update imports at the top of the file. Change:
```typescript
import { rpcClient, RpcError } from "../client.js";
import type { RpcTransport } from "../client.js";
```
to:
```typescript
import { newHttpBatchRpcSession, RpcError } from "../http-batch.js";
import type { RpcTransport } from "../http-batch.js";
```

Then replace all occurrences of `rpcClient` with `newHttpBatchRpcSession` throughout the file. There are 10 occurrences of `rpcClient<` in this file (lines 36, 51, 67, 85, 107, 123, 137, 154, 165, 178).

No logic changes — only import paths and function names change.

**Verification:**

Run: `npm run test -- src/__tests__/client.test.ts`
Expected: All 10 tests pass

**Commit:** `refactor: update client.test.ts to use new function names and imports`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for Symbol.dispose on HTTP batch session

**Verifies:** simplified-exports.AC3.1, simplified-exports.AC3.4

**Files:**
- Modify: `src/__tests__/client.test.ts` (add new describe block)

**Testing:**

Tests must verify:
- simplified-exports.AC3.1: `newHttpBatchRpcSession` return value has `Symbol.dispose` property — call `Symbol.dispose` on the proxy, verify it's a function, verify it doesn't throw
- simplified-exports.AC3.4: `Symbol.dispose` is non-enumerable — verify `Object.keys()` on the proxy is empty, verify spreading the proxy doesn't include `Symbol.dispose`

Note: client.test.ts imports were already updated in Task 3. Tests should import `newHttpBatchRpcSession` from `../http-batch.js`.

**Verification:**

Run: `npm run test`
Expected: All tests pass

**Commit:** `test: add Symbol.dispose tests for HTTP batch session`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: Update server.test.ts imports and function names

**Verifies:** simplified-exports.AC2.1, simplified-exports.AC2.3

**Files:**
- Modify: `src/__tests__/server.test.ts`

**Implementation:**

Update imports. Change:
```typescript
import { handleRpc } from "../server.js";
```
to:
```typescript
import { newHttpBatchRpcResponse } from "../http-batch.js";
```

Replace all occurrences of `handleRpc` with `newHttpBatchRpcResponse` throughout the file. There are 5 call sites (lines 16, 26, 41, 52, 67). Also update the import on line 2 and the describe block name on line 13 (`"handleRpc HTTP wrapper"` → `"newHttpBatchRpcResponse"`).

No logic changes.

**Verification:**

Run: `npm run test -- src/__tests__/server.test.ts`
Expected: All 5 tests pass

**Commit:** `refactor: update server.test.ts to use new function names and imports`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Update e2e.test.ts imports and function names

**Verifies:** simplified-exports.AC2.1, simplified-exports.AC2.2

**Files:**
- Modify: `src/__tests__/e2e.test.ts`

**Implementation:**

Update imports. Change:
```typescript
import { rpcClient, RpcError } from "../client.js";
import { processRpc } from "../server.js";
import type { RpcTransport } from "../client.js";
```
to:
```typescript
import { newHttpBatchRpcSession, RpcError } from "../http-batch.js";
import { processRpc } from "../core.js";
import type { RpcTransport } from "../http-batch.js";
```

Note: `processRpc` now imports from `../core.js` (where it's defined) instead of `../server.js` (which re-exported it). The e2e tests use `processRpc` directly in the in-memory transport, not through the HTTP handler.

Replace all occurrences of `rpcClient` with `newHttpBatchRpcSession` throughout the file. There are 6 occurrences (lines 44, 51, 67, 74, 88, 100).

No logic changes.

**Verification:**

Run: `npm run test -- src/__tests__/e2e.test.ts`
Expected: All 6 tests pass

**Commit:** `refactor: update e2e.test.ts to use new function names and imports`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Update spec.test.ts imports

**Files:**
- Modify: `src/__tests__/spec.test.ts`

**Implementation:**

Update imports. Change:
```typescript
import { processRpc, handleRpc } from "../server.js";
```
to:
```typescript
import { processRpc } from "../core.js";
import { newHttpBatchRpcResponse } from "../http-batch.js";
```

Replace the single occurrence of `handleRpc` with `newHttpBatchRpcResponse` (line 35).

No logic changes.

**Verification:**

Run: `npm run test -- src/__tests__/spec.test.ts`
Expected: All 17 tests pass

**Commit:** `refactor: update spec.test.ts imports`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Update property.test.ts imports

**Files:**
- Modify: `src/__tests__/property.test.ts`

**Implementation:**

Update imports. Change:
```typescript
import { processRpc } from "../server.js";
import type { JsonRpcResponse, JsonRpcErrorResponse } from "../core.js";
```
to:
```typescript
import { processRpc } from "../core.js";
import type { JsonRpcResponse, JsonRpcErrorResponse } from "../core.js";
```

Only the `processRpc` import path changes (from `../server.js` to `../core.js`). The type imports from `../core.js` are already correct.

No logic changes.

**Verification:**

Run: `npm run test -- src/__tests__/property.test.ts`
Expected: All 4 tests pass

**Commit:** `refactor: update property.test.ts imports`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Verify all tests pass

**Files:** None (verification only)

**Step 1: Run the full test suite**

Run: `npm run test`
Expected: All tests pass across all test files (existing tests + Symbol.dispose tests added in Task 4)

Note: `core.test.ts`, `session.test.ts`, and `test-helpers.ts` should not need any changes — they import from `../core.js` and `../session.js` which are unchanged.

**Step 2: Run the build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit (if any fixups needed)**

If any tests needed adjustment beyond import paths, commit the fixes.
<!-- END_TASK_9 -->
