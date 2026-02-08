import { describe, it, expect, vi } from "vitest";
import { rpcClient, RpcError } from "../client.js";
import { processRpc, handleRpc } from "../server.js";
import type { RpcTransport } from "../types.js";

// Service definition
interface CalcService {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  multiply(a: number, b: number): number;
  greet(name: string): string;
  throwError(): never;
  logEvent(event: string): void;
}

// Service implementation
const calcService: CalcService = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  greet: (name) => `Hello, ${name}!`,
  throwError() {
    const err = new Error("Intentional error");
    (err as any).code = -32001;
    (err as any).data = { reason: "test" };
    throw err;
  },
  logEvent: vi.fn(),
};

// In-memory transport: client → processRpc → response
function createInMemoryTransport(service: any): RpcTransport {
  return async (body: string) => {
    const parsed = JSON.parse(body);
    const result = await processRpc(parsed, service);
    // processRpc returns null for notifications-only
    // The transport needs to return valid JSON
    if (result === null) {
      return JSON.stringify([]);
    }
    return JSON.stringify(result);
  };
}

describe("e2e: client → server round trip", () => {
  it("single call", async () => {
    const transport = createInMemoryTransport(calcService);
    const client = rpcClient<CalcService>({ transport });
    const result = await client.add(3, 4);
    expect(result).toBe(7);
  });

  it("batch of 3 calls", async () => {
    const transport = createInMemoryTransport(calcService);
    const client = rpcClient<CalcService>({ transport });
    const [a, b, c] = await Promise.all([
      client.add(1, 2),
      client.subtract(10, 3),
      client.multiply(4, 5),
    ]);
    expect(a).toBe(3);
    expect(b).toBe(7);
    expect(c).toBe(20);
  });

  it("notifications: server executes, no response expected", async () => {
    const logFn = vi.fn();
    const svc = { ...calcService, logEvent: logFn };
    const transport = createInMemoryTransport(svc);
    const client = rpcClient<CalcService>({ transport });
    await client.notify.logEvent("page_view");
    expect(logFn).toHaveBeenCalledWith("page_view");
  });

  it("error propagation: server throws → client gets RpcError", async () => {
    const transport = createInMemoryTransport(calcService);
    const client = rpcClient<CalcService>({ transport });
    await expect(client.throwError()).rejects.toThrow(RpcError);
    try {
      await client.throwError();
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32001);
      expect((err as RpcError).message).toBe("Intentional error");
      expect((err as RpcError).data).toEqual({ reason: "test" });
    }
  });

  it("batch with mixed success/error", async () => {
    const transport = createInMemoryTransport(calcService);
    const client = rpcClient<CalcService>({ transport });
    const pAdd = client.add(1, 2);
    const pThrow = client.throwError();
    const pSub = client.subtract(5, 3);

    expect(await pAdd).toBe(3);
    await expect(pThrow).rejects.toThrow(RpcError);
    expect(await pSub).toBe(2);
  });

  it("method not found propagates as RpcError", async () => {
    const transport = createInMemoryTransport(calcService);
    const client = rpcClient<{ nonexistent(): void }>({ transport });
    await expect(client.nonexistent()).rejects.toThrow(RpcError);
    try {
      await client.nonexistent();
    } catch (err) {
      expect((err as RpcError).code).toBe(-32601);
    }
  });
});

// Transport that goes through handleRpc (HTTP semantics: 204 for notifications)
function createHttpTransport(service: any): RpcTransport {
  return async (body: string) => {
    const request = new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const response = await handleRpc(request, service);
    return response.text();
  };
}

describe("e2e: client → handleRpc (HTTP transport)", () => {
  it("notification resolves successfully over HTTP 204", async () => {
    const logFn = vi.fn();
    const svc = { ...calcService, logEvent: logFn };
    const transport = createHttpTransport(svc);
    const client = rpcClient<CalcService>({ transport });
    await client.notify.logEvent("page_view");
    expect(logFn).toHaveBeenCalledWith("page_view");
  });

  it("batch of only notifications resolves over HTTP 204", async () => {
    const logFn = vi.fn();
    const svc = { ...calcService, logEvent: logFn };
    const transport = createHttpTransport(svc);
    const client = rpcClient<CalcService>({ transport });
    await Promise.all([
      client.notify.logEvent("event1"),
      client.notify.logEvent("event2"),
    ]);
    expect(logFn).toHaveBeenCalledTimes(2);
  });
});
