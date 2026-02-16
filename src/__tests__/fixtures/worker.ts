// Test worker for Workers runtime tests
import { newWorkersRpcResponse } from "../../index.js";
import { RpcSession } from "../../session.js";
import { createWebSocketTransport } from "../../websocket.js";

// Test service shared between HTTP and WebSocket transports
const service = {
  add(a: number, b: number): number {
    return a + b;
  },
  greet(name: string): string {
    return `Hello, ${name}!`;
  },
  echo(...args: unknown[]): unknown[] {
    return args;
  },
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Bidirectional test endpoint: server method calls back to client
    if (url.pathname === "/bidirectional") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 400 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const transport = createWebSocketTransport(server);

      const biService = {
        async addWithClientMultiplier(a: number, b: number): Promise<number> {
          const multiplier: number = await (session.remote as any).getMultiplier();
          return (a + b) * multiplier;
        },
      };

      const session = new RpcSession(transport, biService, { role: "acceptor" });

      return new Response(null, { status: 101, webSocket: client });
    }

    return newWorkersRpcResponse(request, service);
  },
};
