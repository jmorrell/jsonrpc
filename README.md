# @jmorrell/jsonrpc

Lightweight [JSON-RPC 2.0](https://www.jsonrpc.org/specification) library for TypeScript with automatic request batching.

- Type-safe client via TypeScript inference (no codegen)
- Supports batched requests
- Spec-compliant JSON-RPC 2.0
- Transport-agnostic core
- Zero dependencies
- Designed for Cloudflare Workers

## Influences

This library was influenced by the designs of:

- [typed-rpc](https://github.com/fgnass/typed-rpc)
- [capnweb](https://github.com/cloudflare/capnweb)

## Basic usage

### Define a typescript interface

We will use this as a service definition and import it on both the client and server.

```ts
export interface MathService {
  add(a: number, b: number): Promise<number>;
  divide(a: number, b: number): Promise<number>;
}
```

### Define a service

It's not required to use a class here, anything that implements the service interface will work. A class allows you to pass the information beyond just the arguments to the method being invoked. Other examples would be the authenticated user, or set of feature flags.

```ts
export class MathServiceImpl implements MathService {
  constructor(
    protected req: Request,
    protected env: Env,
  ) {}

  add(a: number, b: number) {
    return a + b;
  }

  divide(a: number, b: number) {
    if (b === 0) throw new Error("Division by zero");
    return a / b;
  }
}
```

### Server

```ts
import { handleRpc } from "@jmorrell/jsonrpc/server";
import { mathService } from "./math-service";

// Cloudflare Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleRpc(request, new MathServiceImpl(request, env));
  },
};
```

`handleRpc` reads the request body, parses JSON, dispatches to your service, and returns a `Response`. POST only — other methods get a 405. Notifications return 204.

### Client

```ts
import { rpcClient } from "@jmorrell/jsonrpc/client";
import type { MathService } from "./service";

const client = rpcClient<MathService>({
  url: "https://example.com/api",
  getHeaders: () => ({
    "x-auth-token": "abc123",
  }),
});

const result = await client.add(1, 2); // 3
```

Full autocompletion. Every method returns a `Promise` of its return type.

## Client API

### Auto-batching

Calls made in the same event loop turn are batched into a single HTTP request:

```ts
// These three calls produce ONE HTTP request with a JSON-RPC batch array.
const [sum, difference, product] = await Promise.all([
  client.add(1, 2),
  client.subtract(5, 3),
  client.multiply(2, 4),
]);
```

A single call is sent as a plain JSON-RPC request object (not wrapped in an array), so it works with servers that don't support batching.

Batching uses `setTimeout(0)` — all synchronous calls and microtasks (`.then()`, `queueMicrotask`) within the same turn are included.

### Custom headers

```ts
const client = rpcClient<MathService>({
  url: "https://example.com/api",
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),
});
```

`getHeaders` can be async.

### Custom transport

Replace the default `fetch` transport entirely:

```ts
const client = rpcClient<MathService>({
  transport: async (body: string) => {
    // body is serialized JSON (single request or batch array)
    // Return serialized JSON response
    return await ws.sendAndReceive(body);
  },
});
```

The transport receives a JSON string and must return a JSON string.

## Server API

### `handleRpc(request, service, options?)`

HTTP wrapper. Takes a `Request`, returns a `Response`.

- Non-POST requests get `405 Method Not Allowed` with `Allow: POST` header
- Invalid JSON returns a `-32700 Parse error` response
- Notifications return `204 No Content`
- Everything else returns `200` with `Content-Type: application/json`

CORS is out of scope — handle preflight before calling `handleRpc`.

### `processRpc(body, service, options?)`

Transport-agnostic core. Takes a parsed JSON body (not a `Request`), returns the response object(s) or `null` for notification-only requests.

```ts
// WebSocket example
ws.on("message", async (data) => {
  const body = JSON.parse(data);
  const result = await processRpc(body, myService);
  if (result !== null) ws.send(JSON.stringify(result));
});
```

### Options

```ts
handleRpc(request, service, {
  onError: (err) => console.error(err), // Called when a handler throws
});
```

## Error handling

When a remote method returns a JSON-RPC error, the client throws an `RpcError` with `message`, `code`, and optional `data`:

```ts
import { RpcError } from "@jmorrell/jsonrpc/client";

try {
  await client.divide(1, 0);
} catch (err) {
  if (err instanceof RpcError) {
    console.log(err.message); // "Division by zero"
    console.log(err.code); // -32000
  }
}
```

Internal errors follow the [spec-defined error codes](https://www.jsonrpc.org/specification#error_object):

| Code   | Meaning          |
| ------ | ---------------- |
| -32700 | Parse error      |
| -32600 | Invalid request  |
| -32601 | Method not found |
| -32602 | Invalid params   |
| -32603 | Internal error   |

## Params style

This library uses by-position params only (arrays). Named params (objects) are rejected with `-32602 Invalid params`. This matches how TypeScript function calls naturally map to JSON-RPC.

If you want to use named params, use a single argument object:

```ts
await client.divide({ a: 4, b: 2 });
```

## Security

The server rejects calls to:

- Methods starting with `rpc.` (spec-reserved)
- `Object.prototype` properties (`constructor`, `__proto__`, `toString`, etc.)
- Properties that aren't functions on the service object

## License

MIT
