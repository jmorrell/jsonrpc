# Simplified Exports Implementation Plan — Phase 4

**Goal:** Test all new functions in the actual Workers runtime using `@cloudflare/vitest-pool-workers`. This validates that `WebSocketPair`, `WebSocket.accept()`, and the convenience dispatcher work correctly in workerd.

**Architecture:** Switch from single `vitest.config.ts` to `vitest.workspace.ts` with two projects: "unit" (regular Node environment tests) and "workers" (Workers pool tests via workerd). Create a minimal `wrangler.toml`. Workers tests use the `SELF` binding to send requests to a test worker.

**Tech Stack:** @cloudflare/vitest-pool-workers, Vitest 3.x, workerd, wrangler.toml

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-02-15

---

## Acceptance Criteria Coverage

This phase verifies all ACs in real Workers runtime:

### simplified-exports.AC7: Core internals preserved
- **simplified-exports.AC7.1 Success:** Existing core, session, spec, and property tests pass unchanged (import paths may update)
- **simplified-exports.AC7.2 Success:** End-to-end round-trip tests pass with new API names

All other ACs (AC1-AC6) are re-verified in the Workers runtime environment.

---

<!-- START_TASK_1 -->
### Task 1: Install @cloudflare/vitest-pool-workers

**Files:**
- Modify: `package.json` (add devDependency)

**Step 1: Install the package**

```bash
npm install --save-dev @cloudflare/vitest-pool-workers
```

This package requires Vitest 3.0.x-3.2.x (the project already has `vitest: "^3.0.0"`).

**Step 2: Verify installation**

Run: `npm ls @cloudflare/vitest-pool-workers`
Expected: Package installed successfully

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @cloudflare/vitest-pool-workers for Workers runtime tests"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create wrangler.toml

**Files:**
- Create: `wrangler.toml`

**Step 1: Create minimal wrangler config**

```toml
name = "jsonrpc-test"
main = "src/worker.ts"
compatibility_date = "2024-12-01"
```

The `main` points to the test worker entry point (created in Task 4). This is used by the Workers pool to set up the `SELF` binding.

**Step 2: Commit**

```bash
git add wrangler.toml
git commit -m "chore: add minimal wrangler.toml for Workers pool tests"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Switch to vitest.workspace.ts

**Files:**
- Delete: `vitest.config.ts`
- Create: `vitest.workspace.ts`

**Step 1: Create `vitest.workspace.ts`**

```typescript
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";
import { defineProject } from "vitest/config";

export default [
  // Regular unit/integration tests (Node environment)
  defineProject({
    test: {
      name: "unit",
      include: ["src/__tests__/**/*.test.ts"],
      exclude: ["**/*.workers.test.ts"],
    },
  }),

  // Workers runtime tests (workerd environment)
  defineWorkersProject({
    test: {
      name: "workers",
      include: ["src/__tests__/**/*.workers.test.ts"],
    },
  }),
];
```

The workspace splits tests by file naming convention:
- `*.test.ts` — regular tests, run in Node
- `*.workers.test.ts` — Workers pool tests, run in workerd

**Step 2: Delete old `vitest.config.ts`**

```bash
rm vitest.config.ts
```

**Step 3: Verify existing tests still pass**

Run: `npm run test`
Expected: All existing tests pass (they match `*.test.ts` pattern, excluded from workers project by the `*.workers.test.ts` pattern)

**Step 4: Commit**

```bash
git rm vitest.config.ts
git add vitest.workspace.ts
git commit -m "refactor: switch to vitest workspace with unit + workers projects"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create test worker entry point

**Files:**
- Create: `src/worker.ts`

**Implementation:**

Create a minimal Workers fetch handler that uses `newWorkersRpcResponse` to handle all incoming requests. This serves as the test worker for the `SELF` binding.

```typescript
// src/worker.ts — Test worker for Workers runtime tests
import { newWorkersRpcResponse } from "./index.js";

// Test service shared between HTTP and WebSocket transports
const service = {
  add(a: number, b: number): number {
    return a + b;
  },
  greet(name: string): string {
    return `Hello, ${name}!`;
  },
  echo(...args: unknown[]): unknown[] {
    return args;
  },
};

export default {
  async fetch(request: Request): Promise<Response> {
    return newWorkersRpcResponse(request, service);
  },
};
```

This worker handles both POST (HTTP batch) and WebSocket upgrade requests through the convenience dispatcher.

**Step 2: Exclude worker.ts from build output**

Add `src/worker.ts` to the `exclude` array in `tsconfig.json` so it doesn't get published to `dist/`:

```json
{
  "exclude": ["src/__tests__", "src/worker.ts"]
}
```

This prevents `dist/worker.js` from being included in the published package. The test worker is only used by `@cloudflare/vitest-pool-workers` via `wrangler.toml` and doesn't need to be compiled.

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds. `dist/worker.js` should NOT be present.

**Step 4: Commit**

```bash
git add src/worker.ts tsconfig.json
git commit -m "feat: add test worker entry point for Workers runtime tests"
```
<!-- END_TASK_4 -->

<!-- START_SUBCOMPONENT_A (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Create Workers runtime tests

**Verifies:** simplified-exports.AC7.1, simplified-exports.AC7.2, and re-verifies AC1-AC6 in Workers runtime

**Files:**
- Create: `src/__tests__/workers.workers.test.ts`

**Testing:**

These tests run in the actual Workers runtime (workerd) via `@cloudflare/vitest-pool-workers`. They use the `SELF` binding to send real HTTP requests and WebSocket connections to the test worker.

Tests must verify:

- **HTTP batch round-trip**: POST a JSON-RPC request via `SELF.fetch()`, verify correct response
- **HTTP batch auto-batching**: POST a batch of requests, verify all responses returned correctly
- **HTTP batch error propagation**: POST with unknown method, verify -32601 error
- **HTTP batch CORS**: Verify `Access-Control-Allow-Origin: *` header on POST response
- **HTTP 400 for non-POST/non-upgrade**: GET request returns 400
- **HTTP 405 not returned by dispatcher**: The dispatcher returns 400 (not 405) for non-POST — the 405 comes from `newHttpBatchRpcResponse` directly
- **WebSocket upgrade**: Send request with `Upgrade: websocket` header, verify 101 response
- **WebSocket RPC round-trip**: Open WebSocket to SELF, send JSON-RPC request, verify response
- **WebSocket bidirectional**: (if testable without Durable Objects)
- **Symbol.dispose**: Verify dispose is a function on returned proxy

Note: The SELF binding allows making fetch requests to the test worker. For WebSocket tests, use the Response's `webSocket` property to get the client WebSocket and communicate over it.

Follow existing project test patterns (describe blocks, simple assertions, behavior-focused).

**Verification:**

Run: `npm run test`
Expected: All tests pass (unit + workers)

**Commit:** `test: add Workers runtime integration tests`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Verify full test suite

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests pass — both "unit" and "workers" projects

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Check test counts**

The unit project should run all existing tests (134+). The workers project should run the new workers test file.
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_7 -->
### Task 7: Update AGENTS.md for Workers test setup

**Files:**
- Modify: `AGENTS.md`

**Implementation:**

Update the Testing section to mention the dual-config setup:

```
- Testing: Vitest with fast-check (property-based). Dual workspace:
  - `unit` project: regular tests in src/__tests__/*.test.ts
  - `workers` project: Workers runtime tests in src/__tests__/*.workers.test.ts (uses @cloudflare/vitest-pool-workers)
```

Add `src/worker.ts` to Project Structure:
```
- `src/worker.ts` - Test worker entry point for Workers runtime tests
```

Add `wrangler.toml` mention:
```
- `wrangler.toml` - Minimal Workers config for test worker
```

**Commit:** `docs: update AGENTS.md for Workers test infrastructure`
<!-- END_TASK_7 -->
