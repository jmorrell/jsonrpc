import { describe, it, expect, vi } from "vitest";
import { RpcSession, RpcError } from "../index.js";
import type { RpcTransport } from "../index.js";

// Service definition
type CalcService = {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  multiply(a: number, b: number): number;
  greet(name: string): string;
  throwError(): never;
  logEvent(event: string): void;
};

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

function createLinkedTransports(): [RpcTransport, RpcTransport] {
  let messageHandlerA: ((message: string) => void) | null = null;
  let messageHandlerB: ((message: string) => void) | null = null;
  let closeHandlerA: ((reason?: Error) => void) | null = null;
  let closeHandlerB: ((reason?: Error) => void) | null = null;
  let closed = false;

  const transportA: RpcTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerB?.(message);
    },
    onMessage(handler) {
      messageHandlerA = handler;
    },
    onClose(handler) {
      closeHandlerA = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  const transportB: RpcTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerA?.(message);
    },
    onMessage(handler) {
      messageHandlerB = handler;
    },
    onClose(handler) {
      closeHandlerB = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  return [transportA, transportB];
}

describe("e2e: client ↔ server round trip", () => {
  it("single call", async () => {
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<CalcService, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, calcService, { role: "acceptor" });

    const result = await client.remote.add(3, 4);
    expect(result).toBe(7);
  });

  it("concurrent calls", async () => {
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<CalcService, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, calcService, { role: "acceptor" });

    const [a, b, c] = await Promise.all([
      client.remote.add(1, 2),
      client.remote.subtract(10, 3),
      client.remote.multiply(4, 5),
    ]);
    expect(a).toBe(3);
    expect(b).toBe(7);
    expect(c).toBe(20);
  });

  it("void-returning method resolves Promise<void>", async () => {
    const logFn = vi.fn();
    const svc = { ...calcService, logEvent: logFn };
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<CalcService, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, svc, { role: "acceptor" });

    await client.remote.logEvent("page_view");
    expect(logFn).toHaveBeenCalledWith("page_view");
  });

  it("error propagation: server throws → client gets RpcError", async () => {
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<CalcService, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, calcService, { role: "acceptor" });

    await expect(client.remote.throwError()).rejects.toThrow(RpcError);
    try {
      await client.remote.throwError();
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32001);
      expect((err as RpcError).message).toBe("Intentional error");
      expect((err as RpcError).data).toEqual({ reason: "test" });
    }
  });

  it("concurrent calls with mixed success/error", async () => {
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<CalcService, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, calcService, { role: "acceptor" });

    const pAdd = client.remote.add(1, 2);
    const pThrow = client.remote.throwError();
    const pSub = client.remote.subtract(5, 3);

    expect(await pAdd).toBe(3);
    await expect(pThrow).rejects.toThrow(RpcError);
    expect(await pSub).toBe(2);
  });

  it("method not found propagates as RpcError", async () => {
    const [tA, tB] = createLinkedTransports();
    const client = new RpcSession<{ nonexistent(): void }, Record<string, never>>(tA, {}, { role: "initiator" });
    new RpcSession(tB, calcService, { role: "acceptor" });

    await expect(client.remote.nonexistent()).rejects.toThrow(RpcError);
    try {
      await client.remote.nonexistent();
    } catch (err) {
      expect((err as RpcError).code).toBe(-32601);
    }
  });
});
