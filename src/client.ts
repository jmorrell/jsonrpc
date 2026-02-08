import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  RpcTransport,
  RpcClientOptions,
  RpcFetchOptions,
  RpcClient,
} from "./types.js";

export type { RpcTransport, RpcClientOptions, RpcClient } from "./types.js";

/**
 * Type guard to check if a given object is a valid JSON-RPC response.
 */
export function isJsonRpcResponse(res: unknown): res is JsonRpcResponse {
  if (typeof res !== "object" || res === null) return false;
  if (!("jsonrpc" in res) || (res as any).jsonrpc !== "2.0") return false;
  if (
    !("id" in res) ||
    (typeof (res as any).id !== "string" &&
      typeof (res as any).id !== "number" &&
      (res as any).id !== null)
  )
    return false;

  if ("result" in res) {
    return !("error" in res);
  } else if ("error" in res) {
    const error = (res as JsonRpcErrorResponse).error;
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number" &&
      "message" in error &&
      typeof error.message === "string"
    );
  }

  return false;
}

/**
 * Error class thrown when a remote method returns a JSON-RPC error.
 */
export class RpcError extends Error {
  code: number;
  data?: unknown;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

/**
 * Create a JsonRpcRequest. If idGenerator is undefined, creates a notification (no id).
 */
export function createRequest(
  method: string,
  params?: unknown[],
  idGenerator?: () => number | string
): JsonRpcRequest {
  const req: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
  };

  if (idGenerator) {
    req.id = idGenerator();
  }

  if (params && params.length > 0) {
    req.params = params;
  }

  return req;
}

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

type PendingNotification = {
  resolve: () => void;
  reject: (reason: unknown) => void;
};

const RESERVED_PROPS = new Set(["then", "toJSON", "notify"]);

/**
 * Create a typed JSON-RPC 2.0 client with auto-batching.
 */
export function rpcClient<T extends object>(
  options: RpcClientOptions
): RpcClient<T> {
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
  let pendingNotifications: PendingNotification[] = [];
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
    const notifications = pendingNotifications;
    const requests = pendingRequests;
    pendingCalls = [];
    pendingNotifications = [];
    pendingRequests = [];
    flushScheduled = false;

    if (requests.length === 0) return;

    const isSingleRequest = requests.length === 1 && calls.length === 1 && notifications.length === 0;
    const body = isSingleRequest
      ? JSON.stringify(requests[0])
      : JSON.stringify(requests);

    try {
      const responseText = await transport(body);

      // Empty response (e.g. HTTP 204 for notification-only requests)
      if (!responseText) {
        for (const n of notifications) {
          n.resolve();
        }
        return;
      }

      const parsed = JSON.parse(responseText);

      // Resolve all notifications (they succeeded because transport didn't throw)
      for (const n of notifications) {
        n.resolve();
      }

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
      for (const n of notifications) {
        n.reject(err);
      }
    }
  }

  // Notify proxy
  const notifyProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (RESERVED_PROPS.has(prop as string)) return undefined;
        return (...args: unknown[]) => {
          const req = createRequest(prop as string, args, undefined);
          pendingRequests.push(req);
          return new Promise<void>((resolve, reject) => {
            pendingNotifications.push({ resolve, reject });
            scheduleFlush();
          });
        };
      },
    }
  );

  // Main proxy
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then" || prop === "toJSON") return undefined;
        if (prop === "notify") return notifyProxy;

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
    }
  ) as RpcClient<T>;
}
