// src/worker.ts — Test worker for Workers runtime tests
import { newWorkersRpcResponse } from "./index.js";

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
    return newWorkersRpcResponse(request, service);
  },
};
