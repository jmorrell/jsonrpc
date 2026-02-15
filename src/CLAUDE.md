# src/ - JSON-RPC 2.0 Implementation

Last verified: 2026-02-14

## Purpose
Provides a minimal, type-safe JSON-RPC 2.0 implementation with three modes:
HTTP client (auto-batching), HTTP server, and bidirectional session (WebSocket-style).

## Contracts

### types.ts
- **Exposes**: All shared types. Wire format types (JsonRpcRequest, JsonRpcResponse), transport types (RpcTransport, RpcMessageTransport), client/server/session option types.
- **Guarantees**: No runtime code, only type definitions. Leaf module with no internal imports.

### core.ts (internal -- not a package entry point)
- **Exposes**: Type guards (isJsonRpcRequest, isJsonRpcResponse), request/response builders (createRequest, errorResponse, successResponse), RpcError class, processRpc dispatcher.
- **Guarantees**: processRpc dispatches methods on a service object, rejects rpc.-prefixed methods (spec-reserved), rejects Object.prototype methods (security), ignores notifications without executing them.
- **Expects**: Service object with function properties. By-position params (arrays).

### client.ts (entry point: @jmorrell/jsonrpc/client)
- **Exposes**: rpcClient<T>() returns a Proxy-based typed client. Re-exports RpcError, createRequest, isJsonRpcResponse from core.
- **Guarantees**: Auto-batches calls in same event loop turn via setTimeout(0). Single calls sent as plain objects (not arrays). RpcError thrown on JSON-RPC error responses.
- **Expects**: RpcClientOptions (URL string, fetch options, or custom RpcTransport).

### server.ts (entry point: @jmorrell/jsonrpc/server)
- **Exposes**: handleRpc(request, service, options?) for HTTP. Re-exports processRpc, isJsonRpcRequest from core.
- **Guarantees**: Non-POST returns 405. Invalid JSON returns -32700. Notifications return 204. All else returns 200 with JSON.
- **Expects**: Web-standard Request object and a service object.

### session.ts (entry point: @jmorrell/jsonrpc/session)
- **Exposes**: rpcSession<TRemote, TLocal>(transport, service, options?) returns { remote, close() }.
- **Guarantees**: Bidirectional -- routes incoming messages as requests or responses. Pending calls rejected on close. Role-based ID generation avoids collisions (initiator: positive IDs, acceptor: negative IDs).
- **Expects**: RpcMessageTransport with send/onMessage/onClose/close. Service object for handling incoming calls.

## Key Decisions
- No notifications: Removed client.notify API and server-side notification execution. Incoming notifications are silently ignored (logged via onError). Simplifies the contract.
- Core extraction: Shared logic in core.ts avoids duplication between client/server/session while keeping entry points independent.
- Role-based IDs: Session initiator uses positive incrementing IDs, acceptor uses negative decrementing IDs, so both sides can generate IDs without coordination.
- Proxy-based clients: Both rpcClient and rpcSession.remote use ES Proxy for zero-codegen type safety. Reserved props (then, toJSON) return undefined to avoid Promise/serialization traps.

## Invariants
- core.ts never imports from client.ts, server.ts, or session.ts
- No cross-imports between client.ts, server.ts, and session.ts
- All JSON-RPC error codes follow the spec (-32700, -32600, -32601, -32000 for app errors)
- processRpc never executes notification handlers (returns null for notifications)
- Session close() rejects all pending calls and calls transport.close()
