# Bidirectional RPC Implementation Plan - Phase 4: Session Implementation

**Goal:** Implement the symmetric `rpcSession()` function with message routing, outgoing call proxy, incoming request dispatch, and ID collision avoidance.

**Architecture:** `rpcSession()` combines client behavior (outgoing Proxy + pending-call Map) with server behavior (incoming dispatch via `processRpc`) in a single function. Message routing inspects parsed JSON to determine if it's a request (has `method`) or a response (has `result`/`error`). ID generation uses positive integers for initiator and negative for acceptor.

**Tech Stack:** TypeScript, Vitest

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bidi-rpc.AC2: Bidirectional RPC session

- **bidi-rpc.AC2.1 Success:** Initiator can call methods on acceptor's service via `session.remote`
- **bidi-rpc.AC2.2 Success:** Acceptor can call methods on initiator's service via `session.remote`
- **bidi-rpc.AC2.3 Success:** Both sides can call each other simultaneously without ID collision (initiator uses positive IDs, acceptor uses negative IDs)
- **bidi-rpc.AC2.4 Success:** Void-returning remote methods resolve `Promise<void>` when processed
- **bidi-rpc.AC2.5 Success:** Remote method that throws returns `RpcError` to the caller with code, message, and optional data
- **bidi-rpc.AC2.6 Failure:** Calling a method that doesn't exist on the remote service rejects with -32601 Method not found
- **bidi-rpc.AC2.7 Success:** Messages are sent individually (no batching over message transport)

---

<!-- START_TASK_1 -->

### Task 1: Create `createLinkedTransports` test helper

**Files:**

- Create: `src/__tests__/test-helpers.ts`

**Implementation:**

Create a test helper that produces a pair of linked `RpcMessageTransport` instances. When one side sends a message, the other side's `onMessage` handler receives it.

```typescript
import type { RpcMessageTransport } from "../types.js";

export function createLinkedTransports(): [RpcMessageTransport, RpcMessageTransport] {
  let messageHandlerA: ((message: string) => void) | null = null;
  let messageHandlerB: ((message: string) => void) | null = null;
  let closeHandlerA: ((reason?: Error) => void) | null = null;
  let closeHandlerB: ((reason?: Error) => void) | null = null;
  let closed = false;

  const transportA: RpcMessageTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerB?.(message);
    },
    onMessage(handler) {
      messageHandlerA = handler;
    },
    onClose(handler) {
      closeHandlerA = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  const transportB: RpcMessageTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerA?.(message);
    },
    onMessage(handler) {
      messageHandlerB = handler;
    },
    onClose(handler) {
      closeHandlerB = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  return [transportA, transportB];
}
```

Key design decisions:

- `send()` on A delivers to B's `onMessage` handler synchronously (and vice versa)
- `close()` on either side fires both `onClose` handlers with a reason
- `send()` after close throws (this is tested in Phase 5)
- `closed` flag prevents double-close

**Verification:**

Run: `npm run build`
Expected: Compiles (this file is in `__tests__/`, excluded from build by tsconfig)

**Commit:** `test: add createLinkedTransports test helper`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->

### Task 2: Implement `rpcSession()` in `src/session.ts`

**Verifies:** bidi-rpc.AC2.1, bidi-rpc.AC2.2, bidi-rpc.AC2.3, bidi-rpc.AC2.7

**Files:**

- Modify: `src/session.ts` (currently just type re-exports from Phase 3)

**Implementation:**

Add the `rpcSession()` function to `src/session.ts`. It combines:

- **Outgoing calls:** Proxy-based `remote` object, pending-call Map, ID generation
- **Incoming requests:** Dispatch via `processRpc` from `core.ts`, send response back
- **Message routing:** Parse incoming messages and route to request handler or response resolver

Import from `./core.js`: `processRpc`, `isJsonRpcResponse`, `createRequest`, `RpcError`
Import from `./types.js`: `RpcMessageTransport`, `RpcSessionOptions`, `RpcSession`, `JsonRpcResponse`, `JsonRpcErrorResponse`

Re-export `RpcError` from session entry point so consumers of `@jmorrell/jsonrpc/session` can catch typed errors without importing from `./client` or `./core`.

```typescript
import { processRpc, isJsonRpcResponse, createRequest, RpcError } from "./core.js";
import type {
  RpcMessageTransport,
  RpcSessionOptions,
  RpcSession,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  RpcHandlerOptions,
} from "./types.js";

export { RpcError } from "./core.js";
export type { RpcMessageTransport, RpcSessionOptions, RpcSession } from "./types.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const RESERVED_PROPS = new Set(["then", "toJSON"]);

export function rpcSession<TRemote extends object, TLocal extends object>(
  transport: RpcMessageTransport,
  service: TLocal,
  options?: RpcSessionOptions,
): RpcSession<TRemote, TLocal> {
  const role = options?.role ?? "initiator";
  const onError = options?.onError;
  let nextId = role === "initiator" ? 1 : -1;
  const idStep = role === "initiator" ? 1 : -1;
  const pendingCalls = new Map<number | string, PendingCall>();
  let closed = false;

  // Build RpcHandlerOptions to pass onError through to processRpc
  const handlerOptions: RpcHandlerOptions | undefined = onError ? { onError } : undefined;

  // --- Incoming message handler ---
  transport.onMessage((message: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch (err) {
      onError?.(err);
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      onError?.(new Error("Received non-object JSON-RPC message"));
      return;
    }

    const obj = parsed as Record<string, unknown>;

    // Route: has "method" → incoming request
    if ("method" in obj) {
      handleIncomingRequest(parsed);
      return;
    }

    // Route: has "result" or "error" → incoming response
    if ("result" in obj || "error" in obj) {
      handleIncomingResponse(parsed);
      return;
    }

    // Neither request nor response
    onError?.(new Error("Received unroutable JSON-RPC message"));
  });

  // --- Handle incoming request ---
  async function handleIncomingRequest(parsed: unknown): Promise<void> {
    const response = await processRpc(parsed, service, handlerOptions);
    // response is null for notifications (ignored by processRpc after Phase 2)
    if (response === null) return;

    try {
      transport.send(JSON.stringify(response));
    } catch (err) {
      onError?.(err);
    }
  }

  // --- Handle incoming response ---
  function handleIncomingResponse(parsed: unknown): void {
    if (!isJsonRpcResponse(parsed)) {
      onError?.(new Error("Received invalid JSON-RPC response"));
      return;
    }

    const id = parsed.id;
    if (id === null || id === undefined) {
      onError?.(new Error("Received response with null/undefined ID"));
      return;
    }

    const pending = pendingCalls.get(id);
    if (!pending) {
      onError?.(new Error(`Received response for unknown ID: ${id}`));
      return;
    }

    pendingCalls.delete(id);

    if ("error" in parsed) {
      const { code, message, data } = (parsed as JsonRpcErrorResponse).error;
      pending.reject(new RpcError(message, code, data));
    } else {
      pending.resolve(parsed.result);
    }
  }

  // --- Transport close handler ---
  transport.onClose((reason?: Error) => {
    closed = true;
    const closeError = reason ?? new Error("Connection closed");
    for (const [, pending] of pendingCalls) {
      pending.reject(closeError);
    }
    pendingCalls.clear();
  });

  // --- Outgoing call proxy ---
  const remote = new Proxy({} as TRemote, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (RESERVED_PROPS.has(prop as string)) return undefined;

      return (...args: Array<unknown>) => {
        if (closed) {
          return Promise.reject(new Error("Session is closed"));
        }

        const id = nextId;
        nextId += idStep;
        const req = createRequest(prop as string, args, () => id);

        return new Promise((resolve, reject) => {
          pendingCalls.set(id, { resolve, reject });
          try {
            transport.send(JSON.stringify(req));
          } catch (err) {
            pendingCalls.delete(id);
            reject(err);
          }
        });
      };
    },
  });

  return {
    remote: remote as RpcSession<TRemote, TLocal>["remote"],
    close() {
      if (closed) return;
      closed = true;
      const closeError = new Error("Session closed");
      for (const [, pending] of pendingCalls) {
        pending.reject(closeError);
      }
      pendingCalls.clear();
      transport.close();
    },
  };
}
```

Key implementation decisions:

- **ID generation:** Initiator starts at 1, increments by +1. Acceptor starts at -1, increments by -1. IDs never collide.
- **No batching:** Each outgoing call sends immediately via `transport.send()` — no `setTimeout(0)` batching
- **Message routing:** Checks for `method` field (request) or `result`/`error` field (response)
- **Pending calls:** `Map<number | string, PendingCall>` for O(1) lookup by ID
- **Send failures:** If `transport.send()` throws, only the specific call's promise rejects (error contained)
- **Close behavior:** Sets `closed = true`, rejects all pending calls, calls `transport.close()`

**Verification:**

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `feat: implement rpcSession with bidirectional message routing`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Write session tests for AC2.\*

**Verifies:** bidi-rpc.AC2.1, bidi-rpc.AC2.2, bidi-rpc.AC2.3, bidi-rpc.AC2.4, bidi-rpc.AC2.5, bidi-rpc.AC2.6, bidi-rpc.AC2.7

**Files:**

- Create: `src/__tests__/session.test.ts`

**Testing:**

Tests must verify each AC listed above:

- **bidi-rpc.AC2.1:** Initiator calls method on acceptor's service, gets correct result
- **bidi-rpc.AC2.2:** Acceptor calls method on initiator's service, gets correct result
- **bidi-rpc.AC2.3:** Both sides call each other simultaneously — collect all IDs used and verify no duplicates, verify initiator IDs are positive and acceptor IDs are negative
- **bidi-rpc.AC2.4:** Remote void-returning method resolves `Promise<void>` (result is `null`)
- **bidi-rpc.AC2.5:** Remote method that throws → caller receives `RpcError` with code, message, data
- **bidi-rpc.AC2.6:** Calling method that doesn't exist → rejects with `RpcError` with code `-32601`
- **bidi-rpc.AC2.7:** Each call sends exactly one message (verify transport.send is called once per call, not batched)

Test setup pattern:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rpcSession } from "../session.js";
import { RpcError } from "../core.js";
import { createLinkedTransports } from "./test-helpers.js";
```

Use `createLinkedTransports()` to create paired transports, then create sessions on each side. Services are plain objects with methods.

Follow project testing patterns: `describe/it` blocks, `expect` assertions, `vi.fn()` for mocks.

**Verification:**

Run: `npm run test`
Expected: All tests pass

**Commit:** `test: add session tests for bidirectional RPC`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
