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

// ── Durable Object: pure WebSocket broadcast hub ──
// Accepts WebSocket connections. Any message sent to it gets
// broadcast to every connected socket. No business logic here.

interface Env {
  AUDIT_LOG: DurableObjectNamespace;
}

export class AuditLog implements DurableObject {
  private connections = new Set<WebSocket>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.connections.add(server);

    server.addEventListener("message", (msg) => {
      for (const ws of this.connections) {
        try {
          ws.send(msg.data as string);
        } catch {
          this.connections.delete(ws);
        }
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
    });

    server.addEventListener("error", () => {
      this.connections.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

// ── Pub/sub helper for connecting a Worker to the DO ──

async function connectAuditLog(stub: DurableObjectStub) {
  const resp = await stub.fetch("http://audit-log/connect", {
    headers: { Upgrade: "websocket" },
  });
  const ws = resp.webSocket!;
  ws.accept();

  const subscribers = new Map<string, (event: AuditEvent) => void>();

  ws.addEventListener("message", (msg) => {
    const event: AuditEvent = JSON.parse(msg.data as string);
    for (const cb of subscribers.values()) {
      cb(event);
    }
  });

  return {
    subscribe(cb: (event: AuditEvent) => void): string {
      const id = crypto.randomUUID();
      subscribers.set(id, cb);
      return id;
    },
    cancelSubscription(id: string) {
      console.log("cancelSubscription", id);
      subscribers.delete(id);
      if (subscribers.size === 0) ws.close();
    },
    publish(event: AuditEvent) {
      ws.send(JSON.stringify(event));
    },
  };
}

// ── Worker: handles RPC, publishes events through the DO ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api") {
      // Connect to the singleton broadcast hub
      const doStub = env.AUDIT_LOG.get(env.AUDIT_LOG.idFromName("singleton"));
      const auditLog = await connectAuditLog(doStub);

      // Service methods execute in the Worker, then publish an event
      // through the DO so every connected client sees it.
      const service = {
        async add(a: number, b: number) {
          const result = a + b;
          auditLog.publish({
            timestamp: new Date().toISOString(),
            method: "add",
            args: [a, b],
            result,
          });
          return result;
        },
        async multiply(a: number, b: number) {
          const result = a * b;
          auditLog.publish({
            timestamp: new Date().toISOString(),
            method: "multiply",
            args: [a, b],
            result,
          });
          return result;
        },
        async greet(name: string) {
          const result = `Hello, ${name}!`;
          auditLog.publish({
            timestamp: new Date().toISOString(),
            method: "greet",
            args: [name],
            result,
          });
          return result;
        },
        async now() {
          const result = new Date().toISOString();
          auditLog.publish({
            timestamp: new Date().toISOString(),
            method: "now",
            args: [],
            result,
          });
          return result;
        },
        async echo(...args: unknown[]) {
          auditLog.publish({
            timestamp: new Date().toISOString(),
            method: "echo",
            args,
            result: args,
          });
          return args;
        },
      };

      // Set up bidirectional RPC with the client
      const { response, session } = newWorkersWebSocketRpcSession<
        ClientApi,
        typeof service
      >(request, service);

      // Forward audit events from the DO to this client
      const subId = auditLog.subscribe((event) => {
        session.remote
          .onEvent(event)
          .catch(() => auditLog.cancelSubscription(subId));
      });

      // Clean up the subscription when the WebSocket disconnects
      session.onClose(() => auditLog.cancelSubscription(subId));

      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};
