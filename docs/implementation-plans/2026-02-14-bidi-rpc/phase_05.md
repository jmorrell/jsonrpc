# Bidirectional RPC Implementation Plan - Phase 5: Connection Lifecycle

**Goal:** Handle transport close and session teardown. Ensure all pending calls are properly rejected on disconnect.

**Architecture:** The `rpcSession()` implementation from Phase 4 already includes `onClose` handling and `session.close()`. This is a test-only phase — it verifies and tests those behaviors, adding implementation only if edge cases are found to be missing. No new functionality is expected; Phase 4 front-loads the close/lifecycle code.

**Tech Stack:** TypeScript, Vitest

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bidi-rpc.AC3: Connection lifecycle

- **bidi-rpc.AC3.1 Success:** When transport closes, all pending outgoing calls reject with the close reason
- **bidi-rpc.AC3.2 Success:** `session.close()` calls `transport.close()` and rejects pending calls
- **bidi-rpc.AC3.3 Failure:** Calling `session.remote.method()` after close rejects immediately
- **bidi-rpc.AC3.4 Edge:** Transport closes while a service method is executing — response send is attempted but failure doesn't crash

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->

### Task 1: Verify and refine session close behavior

**Verifies:** bidi-rpc.AC3.1, bidi-rpc.AC3.2, bidi-rpc.AC3.3, bidi-rpc.AC3.4

**Files:**

- Review: `src/session.ts` (verify close behavior from Phase 4 implementation)
- Modify: `src/session.ts` (if any edge cases aren't handled)

**Implementation:**

Review the `rpcSession()` implementation from Phase 4 and verify these behaviors are correctly implemented:

1. **Transport close handler** (`transport.onClose`):
   - Sets `closed = true`
   - Rejects all entries in `pendingCalls` Map with the close reason (or generic "Connection closed" error)
   - Clears the `pendingCalls` Map

2. **`session.close()` method:**
   - Sets `closed = true`
   - Rejects all pending calls with "Session closed" error
   - Clears the `pendingCalls` Map
   - Calls `transport.close()`

3. **Post-close call rejection:**
   - The outgoing Proxy checks `closed` flag before creating a request
   - Returns `Promise.reject(new Error("Session is closed"))` immediately

4. **Transport close during method execution (AC3.4):**
   - When `handleIncomingRequest` calls `processRpc`, the service method may be async
   - If transport closes while the method is executing, the response `transport.send()` will throw
   - The `try/catch` around `transport.send()` in `handleIncomingRequest` should catch this and log via `onError` without crashing

   Verify the `handleIncomingRequest` function handles send failure gracefully:

   ```typescript
   async function handleIncomingRequest(parsed: unknown): Promise<void> {
     const response = await processRpc(parsed, service, handlerOptions);
     if (response === null) return;
     try {
       transport.send(JSON.stringify(response));
     } catch (err) {
       onError?.(err);
     }
   }
   ```

If any of these behaviors are missing from Phase 4, add them now.

**Verification:**

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `feat: refine session close behavior for edge cases` (only if changes needed; skip if Phase 4 already handles everything)

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Write connection lifecycle tests

**Verifies:** bidi-rpc.AC3.1, bidi-rpc.AC3.2, bidi-rpc.AC3.3, bidi-rpc.AC3.4

**Files:**

- Modify: `src/__tests__/session.test.ts` (add lifecycle tests to existing file from Phase 4)

**Testing:**

Add a new `describe("session lifecycle", ...)` block to `src/__tests__/session.test.ts`.

Tests must verify each AC listed above:

- **bidi-rpc.AC3.1:** Create a session, make an outgoing call that won't resolve immediately (use a service method that returns a never-resolving promise or a delayed promise), then close the transport from the other side. Verify the pending call rejects with an error containing the close reason.

- **bidi-rpc.AC3.2:** Create a session, make a pending outgoing call, then call `session.close()`. Verify: (1) pending call rejects, (2) transport's `close()` was called (use a spy on the transport).

- **bidi-rpc.AC3.3:** Create a session, close it, then call `session.remote.someMethod()`. Verify it rejects immediately with "Session is closed" error.

- **bidi-rpc.AC3.4:** Create a session where the acceptor has a slow async service method. Start a call to that method, then close the transport while the method is executing. Verify: (1) the session doesn't throw/crash, (2) the response send failure is logged via `onError`.

For AC3.1 and AC3.2, the tricky part is making a call that stays pending. Options:

- Use a service method that returns `new Promise(() => {})` (never resolves)
- Use a service method with a `setTimeout` that resolves after a delay

Follow project testing patterns.

**Verification:**

Run: `npm run test`
Expected: All tests pass

**Commit:** `test: add session lifecycle tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
