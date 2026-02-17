import { newWorkersRpcResponse } from "@jmorrell/jsonrpc";

const service = {
  add(a: number, b: number): number {
    return a + b;
  },

  multiply(a: number, b: number): number {
    return a * b;
  },

  greet(name: string): string {
    return `Hello, ${name}!`;
  },

  now(): string {
    return new Date().toISOString();
  },

  echo(...args: unknown[]): unknown[] {
    return args;
  },
};

export type Api = typeof service;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api") {
      return newWorkersRpcResponse(request, service);
    }

    return new Response("Not found", { status: 404 });
  },
};
