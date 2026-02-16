import { RpcSession } from "./session.js";
import type { RpcTransport } from "./session.js";
import type { RpcHandlerOptions, PromisifyMethods } from "./core.js";
import { RESERVED_PROPS } from "./core.js";

/**
 * Adapt a WebSocket to the RpcTransport interface.
 * Handles message queuing while the socket is still connecting.
 *
 * @internal
 */
export function createWebSocketTransport(ws: WebSocket): RpcTransport {
  let messageQueue: Array<string> | null = ws.readyState === WebSocket.CONNECTING ? [] : null;

  if (messageQueue) {
    ws.addEventListener("open", () => {
      const queue = messageQueue!;
      messageQueue = null;
      for (const msg of queue) {
        ws.send(msg);
      }
    });
  }

  return {
    send(message: string): void {
      if (messageQueue) {
        messageQueue.push(message);
      } else {
        ws.send(message);
      }
    },
    onMessage(handler: (message: string) => void): void {
      ws.addEventListener("message", (event: MessageEvent) => {
        handler(typeof event.data === "string" ? event.data : String(event.data));
      });
    },
    onClose(handler: (reason?: Error) => void): void {
      ws.addEventListener("close", () => {
        handler();
      });
      ws.addEventListener("error", (_event: Event) => {
        handler(new Error("WebSocket error"));
      });
    },
    close(): void {
      ws.close();
    },
  };
}

/**
 * Handle a WebSocket upgrade request in Cloudflare Workers.
 * Creates a WebSocketPair and starts an RPC session as acceptor.
 *
 * For bidirectional RPC (server calling back to client), use
 * newWorkersWebSocketRpcSession instead.
 *
 * @param request - The HTTP request with Upgrade header
 * @param service - The service object with methods to expose (optional)
 * @param options - RPC handler options
 * @returns A 101 Response with the client WebSocket, or 400 for non-upgrade
 */
export function newWorkersWebSocketRpcResponse<TLocal extends object>(
  request: Request,
  service?: TLocal,
  options?: RpcHandlerOptions,
): Response {
  const { response } = newWorkersWebSocketRpcSession(request, service, options);
  return response;
}

type RemoteProxy<TRemote extends object> = PromisifyMethods<TRemote> &
  Disposable & { close(): void };

/** @internal */
function createRemoteProxy<TRemote extends object>(
  session: RpcSession<TRemote, any>,
): RemoteProxy<TRemote> {
  return new Proxy({} as RemoteProxy<TRemote>, {
    get(_target, prop) {
      if (prop === Symbol.dispose) return () => session.close();
      if (prop === "close") return () => session.close();
      if (typeof prop === "symbol") return undefined;
      if (RESERVED_PROPS.has(prop as string)) return undefined;
      return (session.remote as Record<string, unknown>)[prop];
    },
  });
}

/**
 * Handle a WebSocket upgrade request in Cloudflare Workers, returning
 * both the Response and a typed proxy for calling the client back.
 *
 * For fire-and-forget (no bidirectional calls), use newWorkersWebSocketRpcResponse instead.
 *
 * @param request - The HTTP request with Upgrade header
 * @param service - The service object with methods to expose (optional)
 * @param options - RPC handler options
 * @returns An object with the Response and a typed remote proxy
 */
export function newWorkersWebSocketRpcSession<
  TRemote extends object = Record<string, never>,
  TLocal extends object = Record<string, never>,
>(
  request: Request,
  service?: TLocal,
  options?: RpcHandlerOptions,
): { response: Response; remote: RemoteProxy<TRemote> } {
  if (request.headers.get("Upgrade") !== "websocket") {
    const response = new Response("Expected WebSocket upgrade", { status: 400 });
    const remote = new Proxy({} as RemoteProxy<TRemote>, {
      get(_target, prop) {
        if (prop === Symbol.dispose) return () => {};
        if (prop === "close") return () => {};
        throw new Error("no WebSocket connection: request was not an upgrade request");
      },
    });
    return { response, remote };
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const transport = createWebSocketTransport(server);
  const session = new RpcSession<TRemote, TLocal>(transport, service ?? ({} as TLocal), {
    role: "acceptor",
    onError: options?.onError,
  });

  const remote = createRemoteProxy(session);
  const response = new Response(null, { status: 101, webSocket: client });
  return { response, remote };
}

type WebSocketRpcSessionOptions = {
  onError?: RpcHandlerOptions["onError"];
};

/**
 * Create a WebSocket RPC client session.
 * Accepts a WebSocket URL (string) or an existing WebSocket instance.
 *
 * @param ws - Either a URL string to connect to, or an existing WebSocket instance
 * @param localFunctions - Optional service object for server-to-client calls (bidirectional)
 * @param options - RPC session options
 * @returns A typed proxy with RPC methods and Symbol.dispose for cleanup
 */
export function newWebSocketRpcSession<
  TRemote extends object,
  TLocal extends object = Record<string, never>,
>(
  ws: WebSocket | string,
  localFunctions?: TLocal,
  options?: WebSocketRpcSessionOptions,
): RemoteProxy<TRemote> {
  const socket = typeof ws === "string" ? new WebSocket(ws) : ws;
  const transport = createWebSocketTransport(socket);

  const session = new RpcSession<TRemote, TLocal>(transport, localFunctions ?? ({} as TLocal), {
    role: "initiator",
    onError: options?.onError,
  });

  return createRemoteProxy(session);
}
