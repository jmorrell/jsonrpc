// Test worker for Workers runtime tests
import { newWorkersRpcResponse, newWorkersWebSocketRpcSession } from "../../index.js";

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

type ClientService = { getMultiplier(): number };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Bidirectional test endpoint: server method calls back to client
    if (url.pathname === "/bidirectional") {
      const biService = {
        async addWithClientMultiplier(a: number, b: number): Promise<number> {
          const multiplier = await remote.getMultiplier();
          return (a + b) * multiplier;
        },
      };

      const { response, remote } = newWorkersWebSocketRpcSession<ClientService>(request, biService);
      return response;
    }

    return newWorkersRpcResponse(request, service);
  },
};
