# worker-basic

Interactive playground for `@jmorrell/jsonrpc` on Cloudflare Workers.

Defines a handful of toy RPC methods on the server and serves a static page
where you can invoke them individually or in bulk. A toggle switches between
**HTTP batch** and **WebSocket** transports — the server code is identical
because `newWorkersRpcResponse` routes both automatically.

## Running

```bash
# from repo root — the example links to the local library build
npm run build

# install and build the example
cd examples/worker-basic
npm install
cd web && npm install && npm run build && cd ..

# start the dev server
npm run dev
```

Open http://localhost:8787.

## Structure

```
src/worker.ts          Cloudflare Worker — defines the service and routes /api
web/src/app.ts         Client — uses newHttpBatchRpcSession or newWebSocketRpcSession
web/src/style.css      Styles
web/index.html         Vite entry point
web/vite.config.ts     Aliases @jmorrell/jsonrpc to the local dist build
```

## What it demonstrates

- **Defining a service** — plain object with typed methods, passed to
  `newWorkersRpcResponse`.
- **HTTP auto-batching** — calls made in the same tick are combined into a
  single POST containing a JSON-RPC batch array.
- **WebSocket transport** — persistent connection, each call is an individual
  JSON-RPC message (no batching needed).
- **Type-safe client** — `newHttpBatchRpcSession<Api>` and
  `newWebSocketRpcSession<Api>` return a typed proxy where method calls map
  directly to RPC requests.
- **Raw protocol visibility** — every call shows the JSON-RPC request and
  response side by side.
