# Design: Drop Notifications, Add Bidirectional RPC

## Positioning

A simpler drop-in for capnweb: same bidirectional typed RPC, without object capabilities, built on JSON-RPC 2.0 as a boring, reliable wire format.

This is a **matched-pair library**. The client and server are designed to be used together. Other language clients can talk to the server, but they won't use notification features because none are defined. We never expect to use this client with a different server.

## Key Decision: No Notifications

We remove the notification concept entirely. Every call is a method call. Void-returning methods are just methods that return void.

**Why:**

- Simpler mental model: every call is a call, period
- Error feedback: if a handler throws, the caller always finds out
- Confirmation: `await client.logEvent(...)` resolves when the server *processed* it, not when it was *sent*
- No need for `.notify` proxy, `TNotifications` type params, or server-side notification dispatch
- Matches capnweb's model, where notifications don't exist as a concept

**What we give up:**

- Spec deviation: JSON-RPC 2.0 defines notifications, we choose not to use them
- The server still handles incoming notifications gracefully per spec (for compatibility with third-party clients), but our client never sends them and our API doesn't expose them as a concept

**Wire cost:** Negligible. A void method response is `{ jsonrpc: "2.0", id: 1, result: null }` — a few bytes, and over HTTP it piggybacks on the same response as other batched calls.

## Service Definition

A single interface per side. Void-returning methods are just methods.

```typescript
// Shared types — imported by both client and server
export interface MathService {
  add(a: number, b: number): number;
  divide(a: number, b: number): number;
}

export interface AnalyticsService {
  getReport(id: string): Report;
  getUser(id: string): User;
  logEvent(name: string, data: Record<string, unknown>): void;  // void return, still a method
  trackClick(elementId: string): void;
}
```

No separate notification interfaces. No markers. No wrappers.

## Layer 1: Unidirectional (HTTP)

This is what exists today, minus the `.notify` proxy.

### Client

```typescript
const client = rpcClient<MathService>({ url: "https://example.com/api" });

await client.add(1, 2);          // Promise<number>
await client.divide(10, 2);      // Promise<number>
```

```typescript
const client = rpcClient<AnalyticsService>({ url: "https://example.com/api" });

const report = await client.getReport("q1");            // Promise<Report>
await client.logEvent("page_viewed", { page: "/home" }); // Promise<void> — resolves when processed
await client.trackClick("buy-btn");                       // Promise<void>
```

`logEvent` and `trackClick` behave exactly like `getReport` — they go through the same proxy, get an `id`, and the client awaits the server's response. The only difference is the return type: `void` instead of `Report`.

### Client type

```typescript
export type RpcClient<TMethods extends object> = PromisifyMethods<TMethods>;
```

That's it. No `.notify` sub-proxy. No second type parameter.

### Server

Unchanged from today, except the server no longer needs notification-specific logic:

```typescript
// Cloudflare Worker
export default {
  async fetch(request: Request, env: Env) {
    return handleRpc(request, new AnalyticsServiceImpl(request, env));
  },
};
```

### Auto-batching

Unchanged. Calls in the same event loop tick are batched. Every call has an `id`. Every call gets a response. The batch response includes a result for every request.

### What happens if a third-party client sends a notification?

The server ignores it. Since we have no notification concept, there are no notification handlers to dispatch to, and executing a method silently — with no way to report errors back — contradicts the design principle that every call should get feedback. The server logs a warning via `onError` and produces no response (per spec, servers MUST NOT reply to notifications). Third-party clients that want to call our server should send proper requests with an `id`.

## Layer 2: Bidirectional (WebSocket / MessagePort / etc.)

Both sides can call methods on each other. Each side defines what it exposes.

### Contract — two interfaces

```typescript
// What the server exposes (client calls these)
export interface ServerApi {
  getReport(id: string): Report;
  subscribe(collection: string): void;
  unsubscribe(collection: string): void;
}

// What the client exposes (server calls these)
export interface ClientApi {
  recordAdded(collection: string, record: Record<string, unknown>): void;
  recordUpdated(collection: string, id: string): void;
  sessionExpiring(secondsRemaining: number): void;
  ping(): "pong";
}
```

Both are just interfaces with methods. Some return data, some return void. No special "notification" or "event" concept — the server calls `recordAdded()` on the client the same way the client calls `getReport()` on the server.

### Client

```typescript
const client = rpcClient<ServerApi, ClientApi>({
  transport: websocketTransport("wss://example.com/api"),
  // Client must provide handlers for incoming calls from server
  methods: {
    recordAdded(collection, record) { /* update local cache */ },
    recordUpdated(collection, id) { /* invalidate */ },
    sessionExpiring(seconds) { /* show warning UI */ },
    ping() { return "pong"; },
  },
});

// Client calls server — same as Layer 1
const report = await client.getReport("q1");
await client.subscribe("users");
```

The second type parameter (`ClientApi`) is optional. Omit it for unidirectional usage. When provided, `methods` is required in the options — the type system enforces that you handle everything the server might call.

### Client type

```typescript
export type RpcClient<
  TServerMethods extends object,
  TClientMethods extends object = never,
> = PromisifyMethods<TServerMethods>;

// Options when TClientMethods is provided:
export type RpcClientOptions<TClientMethods> = {
  transport: RpcTransport;
  methods: TClientMethods;  // required when TClientMethods is not never
};
```

The client proxy itself only has server methods on it. The `methods` option is where you provide the client-side handlers — they're not on the proxy because you don't call them yourself.

### Server — per connection

```typescript
function handleWebSocket(ws: WebSocket, env: Env) {
  const session = rpcSession<ServerApi, ClientApi>(
    ws,
    new ServerApiImpl(env),
  );

  // session.remote is a typed proxy for calling THIS client
  await session.remote.ping();                                     // Promise<"pong">
  await session.remote.recordAdded("users", { id: "1", name: "Alice" }); // Promise<void>
  session.remote.sessionExpiring(30);                               // Promise<void>
}
```

`session.remote` is an `RpcClient<ClientApi>` — the same proxy type, just pointing the other direction.

### Broadcast

Session management is application-level, not library-level:

```typescript
const sessions = new Set<RpcSession<ServerApi, ClientApi>>();

ws.addEventListener("open", () => sessions.add(session));
ws.addEventListener("close", () => sessions.delete(session));

// Broadcast to all connected clients
async function notifyRecordAdded(collection: string, record: Record<string, unknown>) {
  await Promise.all(
    [...sessions].map(s => s.remote.recordAdded(collection, record))
  );
}
```

Because these are real method calls (not notifications), the server gets confirmation each client received and processed the message. If a client is disconnected, the promise rejects and you can clean up.

### How bidirectional works on the wire

Both sides run the same dispatch logic on incoming messages:

```
WebSocket message received
  → Is it a JSON-RPC request? (has `method`)
    → Dispatch to local service, send response back
  → Is it a JSON-RPC response? (has `result` or `error`)
    → Match to pending promise by `id`, resolve/reject
```

This is the same `processRpc` that handles HTTP requests today. The only new piece is response dispatching for outgoing calls — which the client already does.

In fact, both sides are running the equivalent of a client + server simultaneously:

```
              ┌─────────────────────┐
              │      Session        │
              │                     │
  Outgoing    │  ┌───────────────┐  │    Incoming
  calls  ────►│  │ Client logic  │  │◄──── responses
              │  │ (send request,│  │
              │  │  match response)│ │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
  Incoming    │  │ Server logic  │  │    Outgoing
  requests───►│  │ (dispatch,    │  │◄──── responses
              │  │  send response)│ │
              │  └───────────────┘  │
              └─────────────────────┘
```

### ID collision avoidance

When both sides send requests, they both generate IDs. To avoid collisions, we borrow capnweb's approach: one side uses positive IDs, the other uses negative IDs. The session initiator (client) uses positive, the acceptor (server) uses negative.

## Transport Abstraction

The current `RpcTransport` is request/response shaped: `(body: string) => Promise<string>`. This works for HTTP but not for bidirectional.

For bidirectional, the transport needs to be message-oriented:

```typescript
// Current — request/response (HTTP)
export type RpcTransport = (body: string) => Promise<string>;

// New — message-oriented (WebSocket, MessagePort, etc.)
export type RpcMessageTransport = {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  close(): void;
};
```

The HTTP fetch transport stays as-is for Layer 1. `RpcMessageTransport` is for Layer 2.

The library could ship a WebSocket transport:

```typescript
export function websocketTransport(urlOrSocket: string | WebSocket): RpcMessageTransport;
```

Other transports (MessagePort, Durable Object stubs, etc.) can be user-provided.

**SSE is a non-goal.** SSE is inherently unidirectional (server → client), which means the client can't respond to server-initiated requests. Since we've dropped notifications and every call is a request expecting a response, SSE doesn't fit the model. If someone really needs SSE, they can build a custom split transport — but it's not something the library optimizes for. Our primary bidirectional target is WebSocket, with good support on Cloudflare (including WebSocket Hibernation).

## Migration from Current API

| Current code | New code | Notes |
|---|---|---|
| `client.notify.logEvent(...)` | `client.logEvent(...)` | Now a real call, returns `Promise<void>` |
| `rpcClient<MyService>(...)` | `rpcClient<MyService>(...)` | Unchanged |
| `handleRpc(req, service)` | `handleRpc(req, service)` | Unchanged |
| `processRpc(body, service)` | `processRpc(body, service)` | Unchanged |

The `.notify` proxy is removed. Any code using it should call the method directly. The method still exists on the service — it just gets a response now.

**Breaking changes:**

- `client.notify` removed — type error at compile time
- `RpcClient` type no longer includes `.notify`
- Server still returns responses for void methods (was 204 for notifications, now 200 with `result: null`)

## What We Keep from JSON-RPC 2.0

- Request/response format (`jsonrpc`, `id`, `method`, `params`, `result`, `error`)
- Error codes (-32700, -32600, -32601, -32602, -32603)
- Batching (array of requests → array of responses)
- `id` matching for response dispatch

## What We Don't Use

- Notifications entirely — not sent by our client, not executed by our server (incoming notifications are ignored with a warning)
- Named params (by-position only)
- SSE transport (unidirectional, can't carry responses)

## Implementation Order

### Phase 1: Remove notifications from client
- Remove `.notify` proxy and `NotifyMethods` type
- Remove `pendingNotifications` tracking
- Update `RpcClient` type to just `PromisifyMethods<T>`
- Update tests

### Phase 2: Simplify server notification handling
- Server still detects and handles notifications from third-party clients (spec compliance)
- Remove any notification-specific options from the API
- Void methods return `{ result: null }` like any other successful call

### Phase 3: Transport abstraction
- Define `RpcMessageTransport` interface
- Keep existing `RpcTransport` for HTTP backward compat
- Implement `websocketTransport`

### Phase 4: Bidirectional support
- `rpcSession` function for creating bidirectional sessions
- Both sides run client + server logic
- ID collision avoidance (positive/negative)
- `session.remote` proxy for calling the other side

### Phase 5: Update README and docs

## Open Questions

1. **Auto-batching over WebSocket:** Does it still make sense? Over HTTP, batching reduces round-trips. Over WebSocket, each message is cheap. Batching might add unnecessary latency (waiting for the `setTimeout(0)` flush). Should WebSocket transport send immediately?

2. **Connection lifecycle:** What happens to pending promises when a WebSocket disconnects? Reject all? With what error?

3. **Reconnection:** Should the library handle reconnection, or leave that to the transport/application?

4. **Request timeout:** Should there be a per-call timeout? Over HTTP the fetch has a natural timeout. Over WebSocket a request could hang forever if the other side never responds.

5. **Backpressure:** If the server calls `session.remote.recordAdded(...)` faster than the client processes them, what happens? The client's handler runs as fast as it can, but messages queue up in the WebSocket buffer. Is this a library concern or application concern?
