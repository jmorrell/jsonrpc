import type { JsonRpcRequest, JsonRpcResponse, PromisifyMethods } from "./core.js";
import { isJsonRpcResponse, RpcError, createRequest } from "./core.js";

export { isJsonRpcResponse, RpcError, createRequest } from "./core.js";

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

// Client proxy type: promisified methods only
export type RpcClient<T extends object> = PromisifyMethods<T>;

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
 * Create a typed JSON-RPC 2.0 client with auto-batching.
 */
export function rpcClient<T extends object>(options: RpcClientOptions): RpcClient<T> {
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
    // Grab the current batch
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
        // Single request mode
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
        // Batch mode
        if (isJsonRpcResponse(parsed) && "error" in parsed) {
          // Server returned a single error for the whole batch
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

        // Build response map by id
        const responseMap = new Map<string | number, JsonRpcResponse>();
        for (const res of parsed) {
          if (isJsonRpcResponse(res)) {
            responseMap.set(res.id as string | number, res);
          }
        }

        // Dispatch to pending calls
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
      // Transport error → reject everything
      for (const call of calls) {
        call.reject(err);
      }
    }
  }

  // Main proxy
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
  ) as RpcClient<T>;
}
