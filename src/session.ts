import {
  processRpc,
  isJsonRpcResponse,
  createRequest,
  RpcError,
  RpcProtocolError,
  RESERVED_PROPS,
} from "./core.js";
import type { RpcHandlerOptions } from "./core.js";
import type { JsonRpcErrorResponse, PromisifyMethods } from "./core.js";

export { RpcError, RpcProtocolError } from "./core.js";
export type { RpcProtocolErrorCode } from "./core.js";

// Message-oriented transport for bidirectional connections
export type RpcMessageTransport = {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (reason?: Error) => void): void;
  close(): void;
};

export type RpcSessionOptions = {
  role?: "initiator" | "acceptor"; // default: 'initiator'
  onError?: (err: RpcProtocolError) => void;
};

export type RpcSession<TRemote extends object, _TLocal extends object> = {
  remote: PromisifyMethods<TRemote>;
  close(): void;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export function rpcSession<TRemote extends object, TLocal extends object>(
  transport: RpcMessageTransport,
  service: TLocal,
  options?: RpcSessionOptions,
): RpcSession<TRemote, TLocal> {
  const role = options?.role ?? "initiator";
  const onError = options?.onError;
  let nextId = role === "initiator" ? 1 : -1;
  const idStep = role === "initiator" ? 1 : -1;
  const pendingCalls = new Map<number | string, PendingCall>();
  let closed = false;

  // Build RpcHandlerOptions to pass onError through to processRpc
  const handlerOptions: RpcHandlerOptions | undefined = onError ? { onError } : undefined;

  // --- Incoming message handler ---
  transport.onMessage((message: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch (err) {
      onError?.(
        new RpcProtocolError("PARSE_ERROR", "Failed to parse JSON-RPC message", { cause: err }),
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      onError?.(new RpcProtocolError("INVALID_MESSAGE", "Received non-object JSON-RPC message"));
      return;
    }

    const obj = parsed as Record<string, unknown>;

    // Route: has "method" → incoming request
    if ("method" in obj) {
      handleIncomingRequest(parsed);
      return;
    }

    // Route: has "result" or "error" → incoming response
    if ("result" in obj || "error" in obj) {
      handleIncomingResponse(parsed);
      return;
    }

    // Neither request nor response
    onError?.(new RpcProtocolError("UNROUTABLE_MESSAGE", "Received unroutable JSON-RPC message"));
  });

  // --- Handle incoming request ---
  async function handleIncomingRequest(parsed: unknown): Promise<void> {
    const response = await processRpc(parsed, service, handlerOptions);
    // response is null for notifications (ignored by processRpc after Phase 2)
    if (response === null) return;

    try {
      transport.send(JSON.stringify(response));
    } catch (err) {
      onError?.(
        new RpcProtocolError("SEND_FAILED", "Failed to send JSON-RPC response", { cause: err }),
      );
    }
  }

  // --- Handle incoming response ---
  function handleIncomingResponse(parsed: unknown): void {
    if (!isJsonRpcResponse(parsed)) {
      onError?.(new RpcProtocolError("INVALID_RESPONSE", "Received invalid JSON-RPC response"));
      return;
    }

    const id = parsed.id;
    if (id === null || id === undefined) {
      onError?.(
        new RpcProtocolError("NULL_RESPONSE_ID", "Received response with null/undefined ID"),
      );
      return;
    }

    const pending = pendingCalls.get(id);
    if (!pending) {
      onError?.(
        new RpcProtocolError("UNKNOWN_RESPONSE_ID", `Received response for unknown ID: ${id}`),
      );
      return;
    }

    pendingCalls.delete(id);

    if ("error" in parsed) {
      const { code, message, data } = (parsed as JsonRpcErrorResponse).error;
      pending.reject(new RpcError(message, code, data));
    } else {
      pending.resolve(parsed.result);
    }
  }

  // --- Transport close handler ---
  transport.onClose((reason?: Error) => {
    closed = true;
    const closeError = reason ?? new Error("Connection closed");
    for (const [, pending] of pendingCalls) {
      pending.reject(closeError);
    }
    pendingCalls.clear();
  });

  // --- Outgoing call proxy ---
  const remote = new Proxy({} as TRemote, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (RESERVED_PROPS.has(prop as string)) return undefined;

      return (...args: Array<unknown>) => {
        if (closed) {
          return Promise.reject(new Error("Session is closed"));
        }

        const id = nextId;
        nextId += idStep;
        const req = createRequest(prop as string, args, () => id);

        return new Promise((resolve, reject) => {
          pendingCalls.set(id, { resolve, reject });
          try {
            transport.send(JSON.stringify(req));
          } catch (err) {
            pendingCalls.delete(id);
            reject(err);
          }
        });
      };
    },
  });

  return {
    remote: remote as RpcSession<TRemote, TLocal>["remote"],
    close() {
      if (closed) return;
      closed = true;
      const closeError = new Error("Session closed");
      for (const [, pending] of pendingCalls) {
        pending.reject(closeError);
      }
      pendingCalls.clear();
      transport.close();
    },
  };
}
