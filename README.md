# @jmorrell/jsonrpc

Lightweight [JSON-RPC 2.0](https://www.jsonrpc.org/specification) library for TypeScript.

- Spec-compliant JSON-RPC 2.0
- Supports batched requests
- Supports bidirectional communication
- Works great with TypeScript
- Transport-agnostic core
- Zero dependencies
- Designed for Cloudflare Workers

## Installation

```
npm i @jmorrell/jsonrpc
```

## Influences

This library was influenced by the designs of:

- [typed-rpc](https://github.com/fgnass/typed-rpc)
- [capnweb](https://github.com/cloudflare/capnweb)

## Comparison with Cap'n Web

Cap'n Web is an object-capabilities RPC library from [Kenton Varda](https://github.com/kentonv). Beyond its
support for object-capabilities, it is designed to integrate very nicely with TypeScript and Cloudflare Workers.
I couldn't find a JSON-RPC library that worked as nicely, so I ~~stole its design~~ used Cap'n Web as inspiration
for a JSON-RPC implementation.

Cap'n Web has a number of benefits over JSON-RPC

- **Object capabilities**. You can pass functions and classes by reference. This is more than a feature, it completely changes how expressive your API can be, and enables patterns that are not possible with a more limited RPC protocol.
- **Pipelining**. Invoke two methods and then pass their results into a third in one round-trip.
- **Support for non-JSON data types**: `ReadableStream`, `bigint`, `Date`

So why would you ever want to use JSON-RPC instead?

Mainly [**it's boring**](https://mcfunley.com/choose-boring-technology) and has been around for longer than a few months. The [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification) was last updated in 2013. Even more impressive, you can sit down with a cup of coffee and read the whole thing. Your coffee might not even be cool enough to drink when you've finished.

A few more points:

- Widely used in the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) which drives code-editing basically everywhere
- Used in [MCP spec](https://modelcontextprotocol.io/specification/2025-11-25)
- Easy to invoke with plain `curl` commands
- Works well with browser dev tools
- Many client implementations in many languages

Cap'n Web is strictly more powerful, and I look forward to seeing it grow and mature, but for many projects today JSON-RPC is a great fit.

## Basic usage

### Define a TypeScript interface

This serves as the service contract. Import it on both client and server for end-to-end type safety.

```ts
export type HelloService = {
  hello(name: string): string;
};
```

### Client (HTTP)

```ts
import { newHttpBatchRpcSession } from "@jmorrell/jsonrpc";

const client = newHttpBatchRpcSession<HelloService>("https://example.com/api");

const result = await client.hello("World");

console.log(result);
```

Full autocompletion. Every method returns a `Promise` of its return type.

### Server (Cloudflare Workers)

```ts
import { newWorkersRpcResponse } from "@jmorrell/jsonrpc";

export class HelloServiceImpl implements HelloService {
  hello(name: string) {
    return `Hello, ${name}!`;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    let url = new URL(request.url);

    if (url.pathname === "/api") {
      return newWorkersRpcResponse(request, new HelloServiceImpl());
    }

    return new Response("Not found", { status: 404 });
  },
};
```

## JSON-RPC Spec Support

This library complies with the JSON-RPC 2.0 Spec, however it intentionally leaves out support for two features:

_Notifications_

Only requests are allowed. You can use a request with a `void` return if you do not need a response.

_Named arguments_

In order to work nicely with TypeScript, we only accept positional arguments. Named params are
rejected with `-32602 Invalid params`. Note that you can use one argment with an object as the
first parameter to immitate using named arguments.

```ts
// Instead of this
example(a: string, b: string, c: string): string

// write your function like this:
example({ a: string, b: string, c: string}): string
```

## HTTP client API

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

Batching uses `setTimeout(0)` -- all synchronous calls and microtasks (`.then()`, `queueMicrotask`) within the same turn are included.

### Custom headers

```ts
const client = newHttpBatchRpcSession<MathService>({
  url: "https://example.com/api",
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),
});
```

`getHeaders` can be async.

## WebSocket RPC

`newWebSocketRpcSession` creates a typed RPC session over a WebSocket. Pass a URL string and it connects for you, or pass an existing `WebSocket` instance.

### Client-to-server calls

```ts
import { newWebSocketRpcSession } from "@jmorrell/jsonrpc";
import type { ServerApi } from "./server";

const session = newWebSocketRpcSession<ServerApi>("wss://example.com/api");

const result = await session.remote.add(1, 2); // 3
```

Unlike the HTTP client, each call is an individual JSON-RPC message over the persistent connection -- no batching needed.

### Bidirectional RPC

Both sides can call methods on each other. The client provides a local service object that the server can invoke:

```ts
import { newWebSocketRpcSession } from "@jmorrell/jsonrpc";
import type { ServerApi, ClientApi } from "./server";

// Local methods the server can call on us.
const localService: ClientApi = {
  onEvent(event) {
    console.log("Server pushed:", event);
  },
};

const session = newWebSocketRpcSession<ServerApi, ClientApi>("wss://example.com/api", localService);

// Call the server.
const result = await session.remote.add(1, 2);
```

On the server side (Cloudflare Workers), use `newWorkersWebSocketRpcSession` to get both the HTTP `Response` and the session handle:

```ts
import { newWorkersWebSocketRpcSession } from "@jmorrell/jsonrpc";

export default {
  async fetch(request: Request) {
    const { response, session } = newWorkersWebSocketRpcSession<ClientApi, typeof service>(
      request,
      service,
    );

    // Push events to the client.
    session.remote.onEvent({ message: "hello" });

    // Clean up when the client disconnects.
    session.onClose(() => {
      console.log("Client disconnected");
    });

    return response;
  },
};
```

### Session lifecycle

```ts
// Register a close handler.
session.onClose(() => console.log("Connection closed"));

// Close the session (also closes the underlying WebSocket).
session.close();

// Supports Symbol.dispose for `using` declarations.
using session = newWebSocketRpcSession<ServerApi>("wss://example.com/api");
```

Calling a remote method after close rejects with `"Session is closed"`. When the WebSocket drops unexpectedly, all pending calls reject and close handlers fire.

## Server API

### `newWorkersRpcResponse(request, service, options?)`

Convenience dispatcher for Cloudflare Workers. Routes based on the request:

- `POST` -> HTTP batch handler (with CORS `Access-Control-Allow-Origin: *`)
- WebSocket upgrade -> WebSocket RPC session
- Anything else -> `400 Bad Request`

### `newHttpBatchRpcResponse(request, service, options?)`

HTTP handler. Takes a `Request`, returns a `Response`.

- Non-POST requests get `405 Method Not Allowed` with `Allow: POST` header
- Invalid JSON returns a `-32700 Parse error` response
- Notifications return `204 No Content`
- Everything else returns `200` with `Content-Type: application/json`

CORS is out of scope -- handle preflight before calling `newHttpBatchRpcResponse`, or use `newWorkersRpcResponse` which adds a permissive CORS header.

### `newWorkersWebSocketRpcResponse(request, service?, options?)`

Fire-and-forget WebSocket handler for Cloudflare Workers. Creates a `WebSocketPair`, starts an RPC session as acceptor, and returns the `101` upgrade response. Use this when you don't need to call methods on the client.

### `newWorkersWebSocketRpcSession(request, service?, options?)`

Same as above, but returns `{ response, session }` so you can use `session.remote` to call methods on the client. See [Bidirectional RPC](#bidirectional-rpc) above.

### `processRpc(body, service, options?)`

Transport-agnostic core. Takes a parsed JSON body (not a `Request`), returns the response object(s) or `null` for notification-only requests. Use this if you need to handle the transport yourself.

```ts
import { processRpc } from "@jmorrell/jsonrpc";

ws.on("message", async (data) => {
  const body = JSON.parse(data);
  const result = await processRpc(body, myService);
  if (result !== null) ws.send(JSON.stringify(result));
});
```

## Error handling

### `RpcError`

When a remote method returns a JSON-RPC error, the client throws an `RpcError` with `message`, `code`, and optional `data`:

```ts
import { RpcError } from "@jmorrell/jsonrpc";

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

### `RpcProtocolError`

Protocol-level issues (malformed messages, unknown response IDs, transport failures) are reported via the `onError` callback as `RpcProtocolError` instances. Each has a `code` string:

| Code                    | Meaning                                 |
| ----------------------- | --------------------------------------- |
| `PARSE_ERROR`           | Malformed JSON on transport             |
| `INVALID_MESSAGE`       | Non-object message received             |
| `UNROUTABLE_MESSAGE`    | Message is neither request nor response |
| `INVALID_RESPONSE`      | Response fails structural validation    |
| `NULL_RESPONSE_ID`      | Response has null/undefined ID          |
| `UNKNOWN_RESPONSE_ID`   | No pending call for response ID         |
| `NOTIFICATION_RECEIVED` | Unsupported notification received       |
| `HANDLER_ERROR`         | Service method threw                    |
| `SEND_FAILED`           | Transport send threw                    |

## License

MIT
