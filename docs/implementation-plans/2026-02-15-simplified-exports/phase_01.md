# Simplified Exports Implementation Plan — Phase 1

**Goal:** Restructure source files into transport-grouped modules with capnweb-compatible function names. Establish single package entry point.

**Architecture:** Move HTTP batch client and server code from separate files (`client.ts`, `server.ts`) into a single `http-batch.ts` module. Create `index.ts` as the sole public entry point. Update `package.json` exports to expose only `"."`.

**Tech Stack:** TypeScript 5.x, tsc build, ESM

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-02-15

---

## Acceptance Criteria Coverage

This phase is infrastructure — file restructuring and build verification. Tests are updated in Phase 2.

### simplified-exports.AC1: Single entry point (partial — old paths removed)

- **simplified-exports.AC1.2 Failure:** `import ... from "@jmorrell/jsonrpc/client"` fails to resolve (old entry point removed) — operationally verified by replacing the `exports` field in Task 3
- **simplified-exports.AC1.3 Failure:** `import ... from "@jmorrell/jsonrpc/server"` fails to resolve — operationally verified
- **simplified-exports.AC1.4 Failure:** `import ... from "@jmorrell/jsonrpc/session"` fails to resolve — operationally verified

These are verified operationally by the `exports` field change (Task 3). The old sub-path entries are removed, so any consumer using the old paths will get a module resolution error. Re-verified in Phase 4 Workers runtime tests.

---

<!-- START_TASK_1 -->

### Task 1: Create src/http-batch.ts

**Files:**

- Create: `src/http-batch.ts`

**Step 1: Create `src/http-batch.ts`**

This file combines the HTTP server handler from `src/server.ts` (renamed `handleRpc` → `newHttpBatchRpcResponse`) and the HTTP client from `src/client.ts` (renamed `rpcClient` → `newHttpBatchRpcSession`). All types are co-located.

The function signatures and internal logic are preserved exactly — only the function names and file location change. Preserve all existing comments and JSDoc from the original files. The `session.ts` re-exports (`RpcProtocolError`, `processRpc`, `isJsonRpcRequest`) that were on `server.ts` are NOT included here — they move to `index.ts`.

```typescript
// src/http-batch.ts
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  PromisifyMethods,
  RpcHandlerOptions,
} from "./core.js";
import { isJsonRpcResponse, RpcError, createRequest, errorResponse, processRpc } from "./core.js";

// --- Server: HTTP batch handler ---

/**
 * HTTP wrapper around processRpc. Takes a Request, returns a Response.
 */
export async function newHttpBatchRpcResponse<T>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify(errorResponse(null, -32700, "Parse error")), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await processRpc(parsed, service, options);

  if (result === null) {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Client: HTTP batch session ---

// Client transport abstraction — takes serialized JSON body, returns serialized JSON response
export type RpcTransport = (body: string) => Promise<string>;

export type RpcFetchOptions = {
  url: string;
  getHeaders?(): Record<string, string> | Promise<Record<string, string>> | undefined;
};

export type RpcClientOptions =
  | string
  | ((RpcFetchOptions | { transport: RpcTransport }) & {
      getHeaders?: never;
    })
  | (RpcFetchOptions & { transport?: never });

/**
 * Create a fetch-based RpcTransport.
 */
function fetchTransport(options: RpcFetchOptions): RpcTransport {
  return async (body: string): Promise<string> => {
    const headers = options.getHeaders ? await options.getHeaders() : {};
    const res = await fetch(options.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body,
    });
    if (!res.ok) {
      throw new RpcError(res.statusText, res.status);
    }
    return res.text();
  };
}

type PendingCall = {
  id: number | string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const RESERVED_PROPS = new Set(["then", "toJSON"]);

/**
 * Create a typed JSON-RPC 2.0 client with auto-batching over HTTP.
 */
export function newHttpBatchRpcSession<T extends object>(
  options: RpcClientOptions,
): PromisifyMethods<T> {
  let transport: RpcTransport;

  if (typeof options === "string") {
    transport = fetchTransport({ url: options });
  } else if ("transport" in options && options.transport) {
    transport = options.transport;
  } else {
    transport = fetchTransport(options as RpcFetchOptions);
  }

  let nextId = 1;
  let pendingCalls: PendingCall[] = [];
  let pendingRequests: JsonRpcRequest[] = [];
  let flushScheduled = false;

  function scheduleFlush() {
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flush, 0);
    }
  }

  async function flush() {
    const calls = pendingCalls;
    const requests = pendingRequests;
    pendingCalls = [];
    pendingRequests = [];
    flushScheduled = false;

    if (requests.length === 0) return;

    const isSingleRequest = requests.length === 1;
    const body = isSingleRequest ? JSON.stringify(requests[0]) : JSON.stringify(requests);

    try {
      const responseText = await transport(body);
      const parsed = JSON.parse(responseText);

      if (isSingleRequest) {
        const call = calls[0];
        if (!isJsonRpcResponse(parsed)) {
          call.reject(new TypeError("Not a valid JSON-RPC 2.0 response"));
          return;
        }
        if (parsed.id !== call.id) {
          call.reject(new RpcError("Response ID does not match request ID", -32000));
          return;
        }
        if ("error" in parsed) {
          const { code, message, data } = parsed.error;
          call.reject(new RpcError(message, code, data));
        } else {
          call.resolve(parsed.result);
        }
      } else {
        if (isJsonRpcResponse(parsed) && "error" in parsed) {
          const { code, message, data } = parsed.error;
          const err = new RpcError(message, code, data);
          for (const call of calls) {
            call.reject(err);
          }
          return;
        }

        if (!Array.isArray(parsed)) {
          const err = new TypeError("Expected array response for batch request");
          for (const call of calls) {
            call.reject(err);
          }
          return;
        }

        const responseMap = new Map<string | number, JsonRpcResponse>();
        for (const res of parsed) {
          if (isJsonRpcResponse(res)) {
            responseMap.set(res.id as string | number, res);
          }
        }

        for (const call of calls) {
          const res = responseMap.get(call.id);
          if (!res) {
            call.reject(new RpcError("No response received for request", -32000));
            continue;
          }
          if ("error" in res) {
            const { code, message, data } = res.error;
            call.reject(new RpcError(message, code, data));
          } else {
            call.resolve(res.result);
          }
        }
      }
    } catch (err) {
      for (const call of calls) {
        call.reject(err);
      }
    }
  }

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (RESERVED_PROPS.has(prop as string)) return undefined;
        if (prop === "notify") return undefined;

        return (...args: unknown[]) => {
          const id = nextId++;
          const req = createRequest(prop as string, args, () => id);
          pendingRequests.push(req);
          return new Promise((resolve, reject) => {
            pendingCalls.push({ id, resolve, reject });
            scheduleFlush();
          });
        };
      },
    },
  ) as PromisifyMethods<T>;
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors (with `moduleResolution: "bundler"`, tsc must check the whole project — individual file checks are not supported)

**Step 3: Commit**

```bash
git add src/http-batch.ts
git commit -m "feat: create http-batch.ts with renamed functions"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create src/index.ts entry point

**Files:**

- Create: `src/index.ts`

**Step 1: Create `src/index.ts`**

This file is the single public entry point. It re-exports from `http-batch.ts` (the new HTTP batch functions and types) and from `core.ts` (the error classes and protocol types that consumers need).

```typescript
// src/index.ts

// HTTP batch transport
export { newHttpBatchRpcResponse, newHttpBatchRpcSession } from "./http-batch.js";
export type { RpcTransport, RpcFetchOptions, RpcClientOptions } from "./http-batch.js";

// Core types and errors
export { RpcError, RpcProtocolError } from "./core.js";
export type {
  RpcProtocolErrorCode,
  RpcHandlerOptions,
  PromisifyMethods,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from "./core.js";
```

Note: `session.ts` internals (`rpcSession`, `RpcMessageTransport`, etc.) are NOT exported from the public API — they are internal and will be used by `websocket.ts` in Phase 3. The old re-exports from `server.ts` (`processRpc`, `isJsonRpcRequest`) are also not part of the new public API — they are internal implementation details.

**Intentionally dropped from public API** (compared to the three-entry-point structure):

- `processRpc`, `isJsonRpcRequest` — internal protocol internals, not needed by consumers
- `createRequest`, `isJsonRpcResponse` — internal helpers used by client implementation
- `rpcSession`, `RpcMessageTransport`, `RpcSessionOptions` — internal session mechanics, consumed only by `websocket.ts`
- `successResponse`, `errorResponse`, `extractError` — internal protocol helpers

These remain accessible as internal imports (from `./core.js` or `./session.js`) for use within the package.

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: create index.ts single entry point"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Update package.json exports to single entry point

**Files:**

- Modify: `package.json` (lines 8-21, the `exports` field)

**Step 1: Replace the exports field**

Change the `exports` field from three sub-paths to a single `"."` entry:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

This replaces the current `"./client"`, `"./server"`, `"./session"` entries. The old import paths (`@jmorrell/jsonrpc/client`, etc.) will no longer resolve.

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds, `dist/index.js` and `dist/index.d.ts` are generated

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: single entry point in package.json exports"
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Delete old source files

**Files:**

- Delete: `src/client.ts`
- Delete: `src/server.ts`

**Step 1: Delete the old files**

```bash
rm src/client.ts src/server.ts
```

These files are fully replaced by `src/http-batch.ts`. The code has been moved (with renamed function names), not modified.

`src/session.ts` is NOT deleted — it remains as an internal module used by the session mechanics and will be consumed by `websocket.ts` in Phase 3.

`src/core.ts` is NOT deleted — it remains as the core protocol internals.

**Step 2: Verify build still succeeds**

Run: `npm run build`
Expected: Build succeeds. The build excludes `src/__tests__/` (per `tsconfig.json` exclude), so broken test imports do not affect the build.

Verify the dist output has the expected files:
Run: `ls dist/`
Expected: Should contain `index.js`, `index.d.ts`, `http-batch.js`, `http-batch.d.ts`, `core.js`, `core.d.ts`, `session.js`, `session.d.ts`

**Step 3: Commit**

```bash
git rm src/client.ts src/server.ts
git commit -m "refactor: remove old client.ts and server.ts (replaced by http-batch.ts)"
```

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Update AGENTS.md to reflect new structure

**Files:**

- Modify: `AGENTS.md` (lines 27-47, Project Structure and Package Entry Points sections)

**Step 1: Update the Project Structure section**

Replace lines describing `src/client.ts` and `src/server.ts` with the new file:

Old:

```
- `src/client.ts` - HTTP client with auto-batching via Proxy (defines client-specific types: RpcTransport, RpcClientOptions, RpcClient)
- `src/server.ts` - HTTP server wrapper (Request in, Response out)
```

New:

```
- `src/http-batch.ts` - HTTP batch transport: newHttpBatchRpcResponse (server) + newHttpBatchRpcSession (client with auto-batching)
```

**Step 2: Update the Package Entry Points section**

Replace the three-entry-point description with the single entry point:

Old:

```
Three public entry points (no barrel index.ts):

- `@jmorrell/jsonrpc/client` - rpcClient, RpcError, createRequest, isJsonRpcResponse
- `@jmorrell/jsonrpc/server` - handleRpc, processRpc, isJsonRpcRequest, RpcProtocolError, RpcProtocolErrorCode
- `@jmorrell/jsonrpc/session` - rpcSession, RpcError, RpcProtocolError, RpcProtocolErrorCode
```

New:

```
Single public entry point via index.ts:

- `@jmorrell/jsonrpc` - newHttpBatchRpcResponse, newHttpBatchRpcSession, RpcError, RpcProtocolError
```

**Step 3: Update the Conventions section**

Remove the line "No barrel index.ts -- consumers import specific entry points" and replace with "Single entry point via index.ts -- consumers import from @jmorrell/jsonrpc".

**Step 4: Update the Module Dependency Rules section**

Add the new files:

```
- http-batch.ts: imports from core.ts
- index.ts: re-exports from http-batch.ts and core.ts
```

Remove the old client.ts and server.ts lines.

**Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for new file structure"
```

<!-- END_TASK_5 -->
