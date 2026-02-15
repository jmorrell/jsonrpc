# Bidirectional RPC Implementation Plan - Phase 6: Error Resilience

**Goal:** Ensure the session survives bad messages without crashing. All error conditions are logged via `onError` and the session continues operating.

**Architecture:** The `rpcSession()` implementation from Phase 4 already includes error handling for malformed JSON, unknown response IDs, and unroutable messages. This is a test-only phase — it verifies and tests those behaviors, adding implementation only if error cases are found to be missing. No new functionality is expected; Phase 4 front-loads the error handling code.

**Tech Stack:** TypeScript, Vitest

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-02-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bidi-rpc.AC4: Error resilience

- **bidi-rpc.AC4.1 Success:** Malformed JSON on transport is logged via `onError` and ignored — session stays alive
- **bidi-rpc.AC4.2 Success:** Response with unknown ID is logged via `onError` and ignored
- **bidi-rpc.AC4.3 Success:** Message that is neither request nor response is logged via `onError` and ignored
- **bidi-rpc.AC4.4 Success:** `transport.send()` throwing rejects only the specific call, not the whole session
- **bidi-rpc.AC4.5 Success:** Incoming notification on session is ignored (not executed), logged via `onError`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->

### Task 1: Verify error handling in session implementation

**Verifies:** bidi-rpc.AC4.1, bidi-rpc.AC4.2, bidi-rpc.AC4.3, bidi-rpc.AC4.4, bidi-rpc.AC4.5

**Files:**

- Review: `src/session.ts`
- Modify: `src/session.ts` (if any error cases aren't handled)

**Implementation:**

Review the `rpcSession()` implementation from Phase 4 and verify these error handling behaviors:

1. **Malformed JSON (AC4.1):** The `transport.onMessage` handler wraps `JSON.parse` in try/catch. On parse failure, calls `onError?.(err)` and returns (does not throw or crash). The session continues accepting messages.

2. **Unknown response ID (AC4.2):** `handleIncomingResponse` checks `pendingCalls.get(id)`. If not found, calls `onError?.(new Error(...))` and returns. The session continues.

3. **Unroutable message (AC4.3):** The message router checks for `method` (request) and `result`/`error` (response). If neither is present, calls `onError?.(new Error("Received unroutable JSON-RPC message"))` and returns.

4. **Send failure (AC4.4):** The outgoing call proxy wraps `transport.send()` in try/catch. If it throws, only that call's promise rejects via `pendingCalls.delete(id); reject(err)`. Other calls are unaffected.

5. **Incoming notification (AC4.5):** `processRpc` from `core.ts` (modified in Phase 2) detects notifications and returns `null` without executing the handler, logging via `onError`. The session's `handleIncomingRequest` then sees `response === null` and skips sending.

If any of these behaviors are missing from Phase 4, add them now.

**Verification:**

Run: `npm run build`
Expected: Compiles without errors

**Commit:** `feat: verify error resilience in session` (only if changes needed; skip if Phase 4 already handles everything)

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Write error resilience tests

**Verifies:** bidi-rpc.AC4.1, bidi-rpc.AC4.2, bidi-rpc.AC4.3, bidi-rpc.AC4.4, bidi-rpc.AC4.5

**Files:**

- Modify: `src/__tests__/session.test.ts` (add error resilience tests to existing file)

**Testing:**

Add a new `describe("session error resilience", ...)` block to `src/__tests__/session.test.ts`.

Tests must verify each AC listed above:

- **bidi-rpc.AC4.1:** Send malformed JSON string directly via transport (e.g., `"not json{"`). Verify: (1) `onError` is called with a `SyntaxError`, (2) session continues to process subsequent valid messages correctly.

- **bidi-rpc.AC4.2:** Send a valid JSON-RPC response with an ID that doesn't match any pending call (e.g., `{"jsonrpc":"2.0","id":99999,"result":"ghost"}`). Verify: (1) `onError` is called, (2) session continues to work for other calls.

- **bidi-rpc.AC4.3:** Send a JSON object that is neither a request nor a response (e.g., `{"jsonrpc":"2.0","data":"something"}`). Verify: (1) `onError` is called with an appropriate error, (2) session stays alive.

- **bidi-rpc.AC4.4:** Create a session with a transport whose `send()` throws on one specific call (use a counter or flag). Make two calls: one that triggers the send failure, one that succeeds. Verify: (1) the failing call rejects, (2) the successful call resolves correctly, (3) session is not closed. This requires a custom transport instead of `createLinkedTransports`.

- **bidi-rpc.AC4.5:** Send a JSON-RPC notification (request without `id` field) to the session's transport. Verify: (1) the method handler on the service is NOT called, (2) `onError` is called with a message about notifications.

For tests that inject raw messages, directly call the transport's message handler rather than going through the linked pair. For example:

```typescript
// Get a reference to the raw transport to inject messages
const [transportA, transportB] = createLinkedTransports();
// transportB.send() delivers to transportA's onMessage handler
// So to inject a raw message into session A, call transportB.send(rawMessage)
```

Follow project testing patterns.

**Verification:**

Run: `npm run test`
Expected: All tests pass

**Commit:** `test: add session error resilience tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
