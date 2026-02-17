# worker-bidirectional

Bidirectional WebSocket RPC with a Durable Object audit log.

We have a bidirectional RPC implementation, so we should use it, right?

This demo has the server invoking remote methods on the client. Each call
on the server emits an event to the client.

It's worth calling out that you likely need some centralized state with this
approach. A worker connected via a websocket could work in theory in that it
can respond to requests coming in over the same connection. However if you have
multiple sessions per user (think multiple tabs, or a desktop or mobile app) you
likely want to send those requests to every session for a particular user.

The best way to do that is a Durable Object. This demo app gives an example. Open
the page in two browser tabs and watch events from one tab appear in the other.

## Setting up a bi-directional WebSocket RPC session

The main difference between this example and `worker-basic` is that we're explicitly setting up a bi-directional WebSocket RPC session with `newWorkersWebSocketRpcSession`. This returns the upgrade response and an `RpcSession`. Use `session.remote` to call methods on the client, and `session.onClose()` to clean up when the connection drops.

```ts
// Set up bidirectional RPC with the client
const { response, session } = newWorkersWebSocketRpcSession<ClientApi, typeof service>(
  request,
  service,
);

// Call methods on the client
session.remote.onEvent(event);

// Clean up when the WebSocket disconnects
session.onClose(() => {
  /* ... */
});
```

## Running

```bash
# from repo root
npm run build

cd examples/worker-bidirectional
npm install
cd web && npm install && npm run build && cd ..

npm run dev
```

Open http://localhost:8787.

## Structure

```
src/worker.ts          Worker + AuditLog Durable Object
web/src/app.ts         Client - bidirectional RPC with onEvent handler
web/src/style.css      Styles (two-column layout)
web/index.html         Vite entry point
web/vite.config.ts     Aliases @jmorrell/jsonrpc to the local dist build
```

## What it demonstrates

- **Bidirectional RPC** — the server calls `onEvent()` on the client, not just
  the other way around.
- **newWorkersWebSocketRpcSession** — returns both the upgrade `Response` and an
  `RpcSession` for calling back into the client and handling disconnect cleanup.
- **newWebSocketRpcSession with local service** — the second type parameter and
  service object register methods the server can invoke.
- **Durable Object** — a singleton DO manages all WebSocket sessions and
  broadcasts events, so every connected tab sees every call.
