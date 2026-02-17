import { newWorkersWebSocketRpcSession } from "@jmorrell/jsonrpc";

// ── Shared types (imported by the client for type safety) ──

export type AuditEvent = {
  timestamp: string;
  method: string;
  args: unknown[];
  result: unknown;
};

export type ServerApi = {
  add(a: number, b: number): number;
  multiply(a: number, b: number): number;
  greet(name: string): string;
  now(): string;
  echo(...args: unknown[]): unknown[];
};

export type ClientApi = {
  onEvent(event: AuditEvent): void;
};

// ── Durable Object: manages connections and broadcasts events ──

interface Env {
  AUDIT_LOG: DurableObjectNamespace;
}

type ClientRemote = { onEvent(event: AuditEvent): Promise<void>; close(): void };

export class AuditLog implements DurableObject {
  private clients = new Map<string, ClientRemote>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const clientId = crypto.randomUUID();

    // Each method executes, then broadcasts an audit event to all
    // connected clients via the bidirectional channel.
    const service = {
      add: async (a: number, b: number) => {
        const result = a + b;
        this.broadcast("add", [a, b], result);
        return result;
      },
      multiply: async (a: number, b: number) => {
        const result = a * b;
        this.broadcast("multiply", [a, b], result);
        return result;
      },
      greet: async (name: string) => {
        const result = `Hello, ${name}!`;
        this.broadcast("greet", [name], result);
        return result;
      },
      now: async () => {
        const result = new Date().toISOString();
        this.broadcast("now", [], result);
        return result;
      },
      echo: async (...args: unknown[]) => {
        this.broadcast("echo", args, args);
        return args;
      },
    };

    const { response, remote } = newWorkersWebSocketRpcSession<ClientApi, typeof service>(
      request,
      service,
    );

    this.clients.set(clientId, remote);

    return response;
  }

  private broadcast(method: string, args: unknown[], result: unknown) {
    const event: AuditEvent = {
      timestamp: new Date().toISOString(),
      method,
      args,
      result,
    };
    for (const [id, client] of this.clients) {
      client.onEvent(event).catch(() => this.clients.delete(id));
    }
  }
}

// ── Worker: routes /api to the singleton Durable Object ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api") {
      const id = env.AUDIT_LOG.idFromName("singleton");
      const stub = env.AUDIT_LOG.get(id);
      return stub.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
