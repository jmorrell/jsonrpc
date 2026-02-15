# Bidirectional RPC Implementation Plan - Phase 1: Extract Shared Core

**Goal:** Move shared runtime code from `client.ts` and `server.ts` into a new `core.ts` module without changing behavior.

**Architecture:** Extract type guards, request/response builders, error utilities, and the `processRpc` dispatch function into `core.ts`. Both `client.ts` and `server.ts` import from `core.ts` instead of defining their own copies. No cross-imports between `client.ts` and `server.ts`.

**Tech Stack:** TypeScript, Vitest

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This is an infrastructure phase. No acceptance criteria are covered — this is a refactoring prerequisite.

**Verifies:** None

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/core.ts` with functions extracted from `server.ts`

**Files:**
- Create: `src/core.ts`
- Modify: `src/server.ts`

**Implementation:**

Create `src/core.ts` containing the following functions currently defined in `src/server.ts`:

- `isJsonRpcRequest` (currently exported at `server.ts:15-23`)
- `errorResponse` (currently internal at `server.ts:25-39`)
- `successResponse` (currently internal at `server.ts:41-46`)
- `extractError` (currently internal at `server.ts:48-72`)
- `processSingleRequest` (currently internal at `server.ts:77-118`)
- `processRpc` (currently exported at `server.ts:124-155`)

All functions should be exported from `core.ts`. Import the types they need from `./types.js`:
- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcErrorResponse`, `JsonRpcSuccessResponse`, `RpcHandlerOptions`

Then update `src/server.ts` to:
1. Remove all six function definitions listed above
2. Import them from `./core.js`: `import { isJsonRpcRequest, errorResponse, processRpc } from "./core.js";`
3. Keep `handleRpc` in `server.ts` (it's the HTTP-specific wrapper)
4. Keep the re-export: `export type { RpcHandlerOptions } from "./types.js";`
5. Re-export `processRpc` and `isJsonRpcRequest` from `server.ts` so existing consumers don't break: `export { processRpc, isJsonRpcRequest } from "./core.js";`

`server.ts` should only contain:
- Type imports from `./types.js`
- Imports from `./core.js`
- Re-exports of `processRpc`, `isJsonRpcRequest`, `RpcHandlerOptions`
- The `handleRpc` function definition and export

**Verification:**

Run: `npm run test`
Expected: All existing tests pass unchanged

**Commit:** `refactor: extract server functions to core.ts`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Move client shared functions to `src/core.ts`

**Files:**
- Modify: `src/core.ts`
- Modify: `src/client.ts`

**Implementation:**

Move these functions from `src/client.ts` to `src/core.ts`:

- `isJsonRpcResponse` (currently exported at `client.ts:16-42`)
- `RpcError` class (currently exported at `client.ts:47-58`)
- `createRequest` (currently exported at `client.ts:63-82`)

Add them as exports in `core.ts`. They need these type imports (already partially imported in core.ts from Task 1):
- `JsonRpcResponse`, `JsonRpcErrorResponse` (for `isJsonRpcResponse`)
- `JsonRpcRequest` (for `createRequest`)

Then update `src/client.ts` to:
1. Remove the three definitions listed above
2. Import them from `./core.js`: `import { isJsonRpcResponse, RpcError, createRequest } from "./core.js";`
3. Re-export them so existing consumers don't break: `export { isJsonRpcResponse, RpcError, createRequest } from "./core.js";`

`client.ts` should only contain:
- Type imports from `./types.js`
- Imports from `./core.js`
- Re-exports of `isJsonRpcResponse`, `RpcError`, `createRequest`, plus type re-exports (`RpcTransport`, `RpcClientOptions`, `RpcClient`)
- `fetchTransport` (internal, HTTP-specific)
- `PendingCall` and `PendingNotification` types (internal)
- `RESERVED_PROPS` constant (internal)
- `rpcClient` function and export

**Verification:**

Run: `npm run test`
Expected: All existing tests pass unchanged

**Commit:** `refactor: extract client functions to core.ts`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify no cross-imports and clean module boundaries

**Files:**
- Review: `src/core.ts`, `src/client.ts`, `src/server.ts`

**Implementation:**

Verify these invariants hold:

1. `core.ts` imports only from `./types.js` — no imports from `client.ts` or `server.ts`
2. `client.ts` imports from `./types.js` and `./core.js` — no imports from `server.ts`
3. `server.ts` imports from `./types.js` and `./core.js` — no imports from `client.ts`
4. All existing tests still import from their original locations (`../client.js`, `../server.js`) and pass without changes

Run a build to confirm type declarations compile correctly.

**Verification:**

Run: `npm run test`
Expected: All existing tests pass unchanged

Run: `npm run build`
Expected: Compiles without errors, produces `dist/core.d.ts`, `dist/core.js`

**Commit:** `refactor: verify clean module boundaries after core extraction`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
