# Bidirectional RPC - Test Requirements

## Overview

Test requirements mapping each acceptance criterion from the bidirectional RPC design to automated tests. All 22 criteria across 4 AC groups are covered by automated tests. No human verification is required.

## Automated Test Coverage

### bidi-rpc.AC1: Notifications removed

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| bidi-rpc.AC1.1 Success | unit | `src/__tests__/client.test.ts` | Accessing `.notify` on client proxy returns `undefined` |
| bidi-rpc.AC1.2 Success | unit | (compiler) | `RpcClient<T>` is equivalent to `PromisifyMethods<T>` — verified by TypeScript compiler during `npm run build` |
| bidi-rpc.AC1.3 Success | e2e | `src/__tests__/e2e.test.ts` | Void-returning method resolves `Promise<void>` when server processes the call |
| bidi-rpc.AC1.4 Success | unit | `src/__tests__/server.test.ts` | `processRpc` returns `null` for notification, handler is NOT called |
| bidi-rpc.AC1.5 Success | unit | `src/__tests__/server.test.ts` | `processRpc` calls `onError` with notification warning message |
| bidi-rpc.AC1.6 Edge | unit | `src/__tests__/server.test.ts` | Batch with mixed requests and notifications: requests produce responses, notification handlers not executed |

### bidi-rpc.AC2: Bidirectional RPC session

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| bidi-rpc.AC2.1 Success | integration | `src/__tests__/session.test.ts` | Initiator calls method on acceptor's service, gets correct result |
| bidi-rpc.AC2.2 Success | integration | `src/__tests__/session.test.ts` | Acceptor calls method on initiator's service, gets correct result |
| bidi-rpc.AC2.3 Success | integration | `src/__tests__/session.test.ts` | Both sides call simultaneously — IDs don't collide, initiator IDs positive, acceptor IDs negative |
| bidi-rpc.AC2.4 Success | integration | `src/__tests__/session.test.ts` | Void-returning remote method resolves `Promise<void>` (result is `null`) |
| bidi-rpc.AC2.5 Success | integration | `src/__tests__/session.test.ts` | Remote method that throws returns `RpcError` with code, message, and data |
| bidi-rpc.AC2.6 Failure | integration | `src/__tests__/session.test.ts` | Calling non-existent method rejects with `RpcError` code `-32601` |
| bidi-rpc.AC2.7 Success | integration | `src/__tests__/session.test.ts` | Each call sends exactly one message (verify transport.send called once per call) |

### bidi-rpc.AC3: Connection lifecycle

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| bidi-rpc.AC3.1 Success | integration | `src/__tests__/session.test.ts` | Transport closes — all pending outgoing calls reject with close reason |
| bidi-rpc.AC3.2 Success | integration | `src/__tests__/session.test.ts` | `session.close()` rejects pending calls and calls `transport.close()` |
| bidi-rpc.AC3.3 Failure | integration | `src/__tests__/session.test.ts` | Calling `session.remote.method()` after close rejects immediately |
| bidi-rpc.AC3.4 Edge | integration | `src/__tests__/session.test.ts` | Transport closes during method execution — send failure logged, no crash |

### bidi-rpc.AC4: Error resilience

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| bidi-rpc.AC4.1 Success | integration | `src/__tests__/session.test.ts` | Malformed JSON logged via `onError`, session stays alive |
| bidi-rpc.AC4.2 Success | integration | `src/__tests__/session.test.ts` | Response with unknown ID logged via `onError`, session continues |
| bidi-rpc.AC4.3 Success | integration | `src/__tests__/session.test.ts` | Unroutable message (neither request nor response) logged via `onError` |
| bidi-rpc.AC4.4 Success | integration | `src/__tests__/session.test.ts` | `transport.send()` throwing rejects only the specific call |
| bidi-rpc.AC4.5 Success | integration | `src/__tests__/session.test.ts` | Incoming notification ignored and logged via `onError` |

## Human Verification

None — all criteria are covered by automated tests. AC1.2 (type equivalence) is verified by the TypeScript compiler during `npm run build`, which runs as part of every phase's verification step.

## Test File Summary

| Test File | Phases | Coverage |
|-----------|--------|----------|
| `src/__tests__/server.test.ts` | Phase 2 | AC1.4, AC1.5, AC1.6 (notification ignoring behavior) |
| `src/__tests__/client.test.ts` | Phase 2 | AC1.1 (`.notify` returns `undefined`) |
| `src/__tests__/e2e.test.ts` | Phase 2 | AC1.3 (void-returning methods) |
| `src/__tests__/spec.test.ts` | Phase 2 | Existing spec tests pass (no new tests, comment update only) |
| `src/__tests__/property.test.ts` | Phase 2 | Existing property tests pass (no changes needed) |
| `src/__tests__/test-helpers.ts` | Phase 4 | `createLinkedTransports()` helper (not a test file itself) |
| `src/__tests__/session.test.ts` | Phases 4-6 | AC2.1-AC2.7, AC3.1-AC3.4, AC4.1-AC4.5 |
