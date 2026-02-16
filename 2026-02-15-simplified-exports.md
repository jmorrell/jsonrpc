# Simplified Exports — capnweb-compatible API

**Status:** Draft
**Date:** 2026-02-15

## Goal

Restructure `@jmorrell/jsonrpc` to provide a single entry point with a capnweb-compatible API surface. The library should work as a drop-in (but less powerful) replacement for capnweb — same function names, similar signatures, simpler internals.

We have capnweb checked out locally at ~/workspace/capnweb if you need to inspect it's approach.

## Single Entry Point

All public API exports from `@jmorrell/jsonrpc`. The existing separate entry points (`/client`, `/server`, `/session`) are removed.

```typescript
import {
  // Server
  newHttpBatchRpcResponse,
  newWorkersWebSocketRpcResponse,
  newWorkersRpcResponse,
  // Client
  newHttpBatchRpcSession,
  newWebSocketRpcSession,
  // Types & Errors
  RpcError,
  RpcProtocolError,
} from "@jmorrell/jsonrpc";
```

## Server Functions

### `newHttpBatchRpcResponse(request, service, options?)`

Wraps the existing `handleRpc`. Takes a web-standard `Request`, calls methods on `service`, returns a `Response`.

- POST only, supports JSON-RPC batches
- Matches capnweb's signature

### `newWorkersWebSocketRpcResponse(request, service?, options?)`

New function. Uses Cloudflare Workers' `WebSocketPair()` to upgrade a request to WebSocket. Creates a bidirectional `rpcSession` over the server-side socket.

- Returns HTTP 101 `Response` with the client socket
- `service` is optional (connection may be client-only)
- Returns 400 if not a WebSocket upgrade request

### `newWorkersRpcResponse(request, service)`

Convenience dispatcher matching capnweb:

- POST → `newHttpBatchRpcResponse` (+ CORS header)
- `Upgrade: websocket` → `newWorkersWebSocketRpcResponse`
- Otherwise → 400

## Client Functions

### `newHttpBatchRpcSession(url, options?)`

Wraps the existing `rpcClient` with auto-batching. Returns a typed proxy. Cannot receive server-initiated requests (HTTP is one-directional).

### `newWebSocketRpcSession(url, localFunctions?, options?)`

New function. Opens a `WebSocket` to the given URL, wraps it in an `RpcMessageTransport`, creates a bidirectional `rpcSession`.

- Returns a typed proxy with `close()` attached
- `localFunctions` is optional — if provided, the server can call methods on the client

## Return Type

Client sessions return the proxy directly with `close()` attached as a property:

```typescript
const api = newWebSocketRpcSession<MyApi>("wss://example.com/rpc");
const result = await api.someMethod("arg");
api.close();
```

## What Changes

| Current                                    | New                              | Change                          |
| ------------------------------------------ | -------------------------------- | ------------------------------- |
| `@jmorrell/jsonrpc/server` → `handleRpc`   | `newHttpBatchRpcResponse`        | Rename + re-export              |
| `@jmorrell/jsonrpc/client` → `rpcClient`   | `newHttpBatchRpcSession`         | Rename + wrap return type       |
| `@jmorrell/jsonrpc/session` → `rpcSession` | Internal only                    | No longer directly exported     |
| —                                          | `newWorkersWebSocketRpcResponse` | New: WebSocketPair + session    |
| —                                          | `newWorkersRpcResponse`          | New: convenience dispatcher     |
| —                                          | `newWebSocketRpcSession`         | New: WebSocket client + session |

## What Stays the Same

- `core.ts` internals (processRpc, type guards, error handling)
- Session mechanics (initiator/acceptor ID generation, message routing)
- Auto-batching behavior in HTTP client
- `RpcError`, `RpcProtocolError`, and error code types

## Not In Scope

capnweb features that this library does not replicate:

- Pipelining
- `RpcTarget` / pass-by-reference
- `RpcStub` / `RpcPromise` lazy evaluation
- Serialization framework
