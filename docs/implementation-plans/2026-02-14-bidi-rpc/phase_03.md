# Bidirectional RPC Implementation Plan - Phase 3: Transport Interface and Session Types

**Goal:** Define the message-oriented transport contract and session types. Add a `./session` package entry point.

**Architecture:** Add `RpcMessageTransport`, `RpcSessionOptions`, and `RpcSession` type definitions to `types.ts`. Create a thin `session.ts` module that re-exports these types. Register `./session` as a package export in `package.json`.

**Tech Stack:** TypeScript

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This is an infrastructure phase. No acceptance criteria are covered — this is type infrastructure for Phases 4-6.

**Verifies:** None

---

<!-- START_TASK_1 -->

### Task 1: Add transport and session types to `src/types.ts`

**Files:**

- Modify: `src/types.ts:63-67` (append after existing `RpcHandlerOptions` type)

**Implementation:**

Add these type definitions at the end of `src/types.ts`:

```typescript
// Message-oriented transport for bidirectional connections
export type RpcMessageTransport = {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (reason?: Error) => void): void;
  close(): void;
};

// Session types
export type RpcSessionOptions = {
  role?: "initiator" | "acceptor"; // default: 'initiator'
  onError?: (err: unknown) => void;
};

export type RpcSession<TRemote extends object, TLocal extends object> = {
  remote: PromisifyMethods<TRemote>;
  close(): void;
};
```

**Prerequisite:** `RpcSession` references `PromisifyMethods<T>` which must be exported from `types.ts`. Phase 2 Task 2 adds this export. Verify `PromisifyMethods` has the `export` keyword in `src/types.ts` before adding these types. If Phase 2 has not been completed, add `export` to the `PromisifyMethods` type definition first.

**Verification:**

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `feat: add transport and session type definitions`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/session.ts` entry point

**Files:**

- Create: `src/session.ts`

**Implementation:**

Create `src/session.ts` that re-exports the session-related types:

```typescript
export type { RpcMessageTransport, RpcSessionOptions, RpcSession } from "./types.js";
```

This is a thin entry point. The `rpcSession()` function will be added in Phase 4.

**Verification:**

Run: `npm run build`
Expected: Compiles without errors, produces `dist/session.d.ts` and `dist/session.js`

**Commit:** `feat: add session entry point module`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Add `./session` package export

**Files:**

- Modify: `package.json:5-14` (add to `exports` field)

**Implementation:**

Add a `./session` entry to the `exports` field in `package.json`:

```json
{
  "exports": {
    "./client": {
      "types": "./dist/client.d.ts",
      "import": "./dist/client.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    },
    "./session": {
      "types": "./dist/session.d.ts",
      "import": "./dist/session.js"
    }
  }
}
```

**Verification:**

Run: `npm run build`
Expected: Compiles without errors

Run: `npm run test`
Expected: All existing tests still pass

**Commit:** `feat: add ./session package export`

<!-- END_TASK_3 -->
