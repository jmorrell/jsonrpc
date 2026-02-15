// pattern: Imperative Shell

import {
  processRpc,
  isJsonRpcResponse,
  createRequest,
  RpcError,
} from "./core.js";
import type {
  RpcMessageTransport,
  RpcSessionOptions,
  RpcSession,
  JsonRpcErrorResponse,
  RpcHandlerOptions,
} from "./types.js";

export { RpcError } from "./core.js";
export type {
  RpcMessageTransport,
  RpcSessionOptions,
  RpcSession,
} from "./types.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const RESERVED_PROPS = new Set(["then", "toJSON"]);

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
  const handlerOptions: RpcHandlerOptions | undefined = onError
    ? { onError }
    : undefined;

  // --- Incoming message handler ---
  transport.onMessage((message: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch (err) {
      onError?.(err);
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      onError?.(new Error("Received non-object JSON-RPC message"));
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
    onError?.(new Error("Received unroutable JSON-RPC message"));
  });

  // --- Handle incoming request ---
  async function handleIncomingRequest(parsed: unknown): Promise<void> {
    const response = await processRpc(parsed, service, handlerOptions);
    // response is null for notifications (ignored by processRpc after Phase 2)
    if (response === null) return;

    try {
      transport.send(JSON.stringify(response));
    } catch (err) {
      onError?.(err);
    }
  }

  // --- Handle incoming response ---
  function handleIncomingResponse(parsed: unknown): void {
    if (!isJsonRpcResponse(parsed)) {
      onError?.(new Error("Received invalid JSON-RPC response"));
      return;
    }

    const id = parsed.id;
    if (id === null || id === undefined) {
      onError?.(new Error("Received response with null/undefined ID"));
      return;
    }

    const pending = pendingCalls.get(id);
    if (!pending) {
      onError?.(new Error(`Received response for unknown ID: ${id}`));
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
  const remote = new Proxy(
    {} as TRemote,
    {
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
    },
  );

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
