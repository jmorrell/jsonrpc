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
export type RpcTransport = {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (reason?: Error) => void): void;
  close(): void;
};

export type RpcSessionOptions = {
  // In bidirectional RPC, both sides send requests with an `id` field that the
  // peer echoes back in its response. JSON-RPC IDs are shared on the wire — if
  // both sides independently pick the same ID, responses become ambiguous and
  // there is no way to recover. The `role` option solves this by assigning each
  // side a non-overlapping ID range: initiators count up (1, 2, 3…) and
  // acceptors count down (-1, -2, -3…), guaranteeing zero collisions by
  // construction. Higher-level helpers (e.g. newWebSocketRpcSession) set this
  // automatically; only callers using RpcSession with a raw transport need to
  // provide it.
  role?: "initiator" | "acceptor"; // default: 'initiator'
  onError?: (err: RpcProtocolError) => void;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

class RpcSessionImpl<TRemote extends object, TLocal extends object> {
  readonly remote: PromisifyMethods<TRemote>;
  private nextId: number;
  private readonly idStep: number;
  private readonly pendingCalls = new Map<number | string, PendingCall>();
  private closed = false;
  private readonly onError?: (err: RpcProtocolError) => void;
  private readonly handlerOptions: RpcHandlerOptions | undefined;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(
    private readonly transport: RpcTransport,
    private readonly service: TLocal,
    options?: RpcSessionOptions,
  ) {
    const role = options?.role ?? "initiator";
    this.onError = options?.onError;
    this.nextId = role === "initiator" ? 1 : -1;
    this.idStep = role === "initiator" ? 1 : -1;
    this.handlerOptions = this.onError ? { onError: this.onError } : undefined;

    transport.onMessage((message: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (err) {
        this.onError?.(
          new RpcProtocolError("PARSE_ERROR", "Failed to parse JSON-RPC message", { cause: err }),
        );
        return;
      }

      if (typeof parsed !== "object" || parsed === null) {
        this.onError?.(
          new RpcProtocolError("INVALID_MESSAGE", "Received non-object JSON-RPC message"),
        );
        return;
      }

      const obj = parsed as Record<string, unknown>;

      // Route: has "method" → incoming request
      if ("method" in obj) {
        this.handleIncomingRequest(parsed);
        return;
      }

      // Route: has "result" or "error" → incoming response
      if ("result" in obj || "error" in obj) {
        this.handleIncomingResponse(parsed);
        return;
      }

      // Neither request nor response
      this.onError?.(
        new RpcProtocolError("UNROUTABLE_MESSAGE", "Received unroutable JSON-RPC message"),
      );
    });

    transport.onClose((reason?: Error) => {
      if (this.closed) return;
      this.closed = true;
      const closeError = reason ?? new Error("Connection closed");
      for (const [, pending] of this.pendingCalls) {
        pending.reject(closeError);
      }
      this.pendingCalls.clear();
      for (const handler of this.closeHandlers) {
        handler();
      }
    });

    this.remote = new Proxy({} as TRemote, {
      get: (_target, prop) => {
        if (typeof prop === "symbol") return undefined;
        if (RESERVED_PROPS.has(prop as string)) return undefined;

        return (...args: Array<unknown>) => {
          if (this.closed) {
            return Promise.reject(new Error("Session is closed"));
          }

          const id = this.nextId;
          this.nextId += this.idStep;
          const req = createRequest(prop as string, args, () => id);

          return new Promise((resolve, reject) => {
            this.pendingCalls.set(id, { resolve, reject });
            try {
              this.transport.send(JSON.stringify(req));
            } catch (err) {
              this.pendingCalls.delete(id);
              reject(err);
            }
          });
        };
      },
    }) as PromisifyMethods<TRemote>;
  }

  private async handleIncomingRequest(parsed: unknown): Promise<void> {
    const response = await processRpc(parsed, this.service, this.handlerOptions);
    if (response === null) return;

    try {
      this.transport.send(JSON.stringify(response));
    } catch (err) {
      this.onError?.(
        new RpcProtocolError("SEND_FAILED", "Failed to send JSON-RPC response", { cause: err }),
      );
    }
  }

  private handleIncomingResponse(parsed: unknown): void {
    if (!isJsonRpcResponse(parsed)) {
      this.onError?.(
        new RpcProtocolError("INVALID_RESPONSE", "Received invalid JSON-RPC response"),
      );
      return;
    }

    const id = parsed.id;
    if (id === null || id === undefined) {
      this.onError?.(
        new RpcProtocolError("NULL_RESPONSE_ID", "Received response with null/undefined ID"),
      );
      return;
    }

    const pending = this.pendingCalls.get(id);
    if (!pending) {
      this.onError?.(
        new RpcProtocolError("UNKNOWN_RESPONSE_ID", `Received response for unknown ID: ${id}`),
      );
      return;
    }

    this.pendingCalls.delete(id);

    if ("error" in parsed) {
      const { code, message, data } = (parsed as JsonRpcErrorResponse).error;
      pending.reject(new RpcError(message, code, data));
    } else {
      pending.resolve(parsed.result);
    }
  }

  onClose(handler: () => void): void {
    if (this.closed) {
      handler();
      return;
    }
    this.closeHandlers.push(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const closeError = new Error("Session closed");
    for (const [, pending] of this.pendingCalls) {
      pending.reject(closeError);
    }
    this.pendingCalls.clear();
    for (const h of this.closeHandlers) {
      h();
    }
    this.transport.close();
  }
}

// Public interface that wraps RpcSessionImpl and hides implementation details
// (even from JavaScript with no type enforcement).
export class RpcSession<TRemote extends object, TLocal extends object> {
  #impl: RpcSessionImpl<TRemote, TLocal>;

  constructor(transport: RpcTransport, service: TLocal, options?: RpcSessionOptions) {
    this.#impl = new RpcSessionImpl(transport, service, options);
  }

  get remote(): PromisifyMethods<TRemote> {
    return this.#impl.remote;
  }

  onClose(handler: () => void): void {
    this.#impl.onClose(handler);
  }

  close(): void {
    this.#impl.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
