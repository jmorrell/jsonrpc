# worker-bidirectional

Bidirectional WebSocket RPC with a Durable Object audit log.

The server defines the same toy methods as `worker-basic`, but each call also
broadcasts an audit event to every connected client via `onEvent()` — a method
the _server_ calls on the _client_. Open the page in two browser tabs and watch
events from one tab appear in the other.

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
web/src/app.ts         Client — bidirectional RPC with onEvent handler
web/src/style.css      Styles (two-column layout)
web/index.html         Vite entry point
web/vite.config.ts     Aliases @jmorrell/jsonrpc to the local dist build
```

## What it demonstrates

- **Bidirectional RPC** — the server calls `onEvent()` on the client, not just
  the other way around.
- **newWorkersWebSocketRpcSession** — returns both the upgrade `Response` and a
  typed `remote` proxy for calling back into the client.
- **newWebSocketRpcSession with local service** — the second type parameter and
  service object register methods the server can invoke.
- **Durable Object** — a singleton DO manages all WebSocket sessions and
  broadcasts events, so every connected tab sees every call.
