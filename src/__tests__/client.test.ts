import { describe, it, expect, vi } from "vitest";
import {
  rpcClient,
  createRequest,
  isJsonRpcResponse,
  RpcError,
} from "../client.js";
import type { RpcTransport } from "../types.js";

// --- isJsonRpcResponse ---

describe("isJsonRpcResponse", () => {
  it("accepts a success response", () => {
    expect(
      isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: 42 })
    ).toBe(true);
  });

  it("accepts an error response", () => {
    expect(
      isJsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid Request" },
      })
    ).toBe(true);
  });

  it("accepts null id", () => {
    expect(
      isJsonRpcResponse({ jsonrpc: "2.0", id: null, result: "ok" })
    ).toBe(true);
  });

  it("rejects missing jsonrpc", () => {
    expect(isJsonRpcResponse({ id: 1, result: 42 })).toBe(false);
  });

  it("rejects wrong jsonrpc version", () => {
    expect(
      isJsonRpcResponse({ jsonrpc: "1.0", id: 1, result: 42 })
    ).toBe(false);
  });

  it("rejects missing id", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", result: 42 })).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse(42)).toBe(false);
    expect(isJsonRpcResponse("hello")).toBe(false);
  });

  it("rejects response with both result and error", () => {
    expect(
      isJsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        result: 42,
        error: { code: -1, message: "err" },
      })
    ).toBe(false);
  });

  it("rejects error response with invalid error object", () => {
    expect(
      isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: "not an object" })
    ).toBe(false);
  });
});

// --- createRequest ---

describe("createRequest", () => {
  it("creates a valid request with auto-incrementing ID", () => {
    let nextId = 1;
    const req1 = createRequest("add", [1, 2], () => nextId++);
    const req2 = createRequest("sub", [3, 1], () => nextId++);
    expect(req1).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "add",
      params: [1, 2],
    });
    expect(req2).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "sub",
      params: [3, 1],
    });
  });

  it("omits params when none provided", () => {
    const req = createRequest("ping", undefined, () => 1);
    expect(req).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect("params" in req).toBe(false);
  });

  it("omits params when empty array", () => {
    const req = createRequest("ping", [], () => 1);
    expect("params" in req).toBe(false);
  });

  it("creates notification (no id) when id generator returns undefined", () => {
    const req = createRequest("logEvent", ["test"], undefined);
    expect(req.method).toBe("logEvent");
    expect(req.params).toEqual(["test"]);
    expect("id" in req).toBe(false);
  });
});

// --- RpcError ---

describe("RpcError", () => {
  it("has correct properties", () => {
    const err = new RpcError("test error", -32600, { detail: "info" });
    expect(err.message).toBe("test error");
    expect(err.code).toBe(-32600);
    expect(err.data).toEqual({ detail: "info" });
    expect(err.name).toBe("RpcError");
    expect(err instanceof RpcError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// --- Client batching tests ---

describe("rpcClient batching", () => {
  function mockTransport(): { transport: RpcTransport; calls: string[] } {
    const calls: string[] = [];
    const transport: RpcTransport = vi.fn(async (body: string) => {
      calls.push(body);
      const req = JSON.parse(body);
      if (Array.isArray(req)) {
        const responses = req
          .filter((r: any) => "id" in r)
          .map((r: any) => ({
            jsonrpc: "2.0",
            id: r.id,
            result: `result-${r.method}`,
          }));
        return JSON.stringify(responses);
      } else {
        return JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: `result-${req.method}`,
        });
      }
    });
    return { transport, calls };
  }

  it("single call sends single object (not array)", async () => {
    const { transport, calls } = mockTransport();
    type Svc = { add(a: number, b: number): number };
    const client = rpcClient<Svc>({ transport });
    const result = await client.add(1, 2);
    expect(result).toBe("result-add");
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]);
    expect(Array.isArray(sent)).toBe(false);
    expect(sent.method).toBe("add");
  });

  it("two synchronous calls produce one batch request", async () => {
    const { transport, calls } = mockTransport();
    type Svc = {
      add(a: number, b: number): number;
      sub(a: number, b: number): number;
    };
    const client = rpcClient<Svc>({ transport });
    const [a, b] = await Promise.all([client.add(1, 2), client.sub(3, 1)]);
    expect(a).toBe("result-add");
    expect(b).toBe("result-sub");
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("two await-separated calls produce two separate requests", async () => {
    const { transport, calls } = mockTransport();
    type Svc = {
      add(a: number, b: number): number;
      sub(a: number, b: number): number;
    };
    const client = rpcClient<Svc>({ transport });
    await client.add(1, 2);
    await client.sub(3, 1);
    expect(calls).toHaveLength(2);
  });

  it("dispatches correct result to correct promise by ID", async () => {
    const transport: RpcTransport = vi.fn(async (body: string) => {
      const req = JSON.parse(body);
      // Return responses in reverse order
      const responses = [...req].reverse().map((r: any) => ({
        jsonrpc: "2.0",
        id: r.id,
        result: r.params[0] + r.params[1],
      }));
      return JSON.stringify(responses);
    });
    type Svc = { add(a: number, b: number): number };
    const client = rpcClient<Svc>({ transport });
    const [a, b] = await Promise.all([client.add(1, 2), client.add(10, 20)]);
    expect(a).toBe(3);
    expect(b).toBe(30);
  });

  it("batch with mixed successes and errors", async () => {
    const transport: RpcTransport = vi.fn(async (body: string) => {
      const req = JSON.parse(body);
      const responses = req.map((r: any) => {
        if (r.method === "fail") {
          return {
            jsonrpc: "2.0",
            id: r.id,
            error: { code: -32000, message: "fail" },
          };
        }
        return { jsonrpc: "2.0", id: r.id, result: "ok" };
      });
      return JSON.stringify(responses);
    });
    type Svc = { ok(): string; fail(): string };
    const client = rpcClient<Svc>({ transport });
    const pOk = client.ok();
    const pFail = client.fail();
    expect(await pOk).toBe("ok");
    await expect(pFail).rejects.toThrow(RpcError);
    await expect(pFail).rejects.toMatchObject({ code: -32000, message: "fail" });
  });

  it("transport failure rejects all promises in batch", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      throw new Error("network error");
    });
    type Svc = { a(): string; b(): string };
    const client = rpcClient<Svc>({ transport });
    const pA = client.a();
    const pB = client.b();
    await expect(pA).rejects.toThrow("network error");
    await expect(pB).rejects.toThrow("network error");
  });

  it("fewer responses than requests rejects unmatched promises", async () => {
    const transport: RpcTransport = vi.fn(async (body: string) => {
      const req = JSON.parse(body);
      // Only respond to first request
      return JSON.stringify([
        { jsonrpc: "2.0", id: req[0].id, result: "ok" },
      ]);
    });
    type Svc = { a(): string; b(): string };
    const client = rpcClient<Svc>({ transport });
    const pA = client.a();
    const pB = client.b();
    expect(await pA).toBe("ok");
    await expect(pB).rejects.toThrow();
  });

  it("unrecognized IDs in batch responses are silently ignored", async () => {
    const transport: RpcTransport = vi.fn(async (body: string) => {
      const req = JSON.parse(body);
      return JSON.stringify([
        { jsonrpc: "2.0", id: req[0].id, result: "ok" },
        { jsonrpc: "2.0", id: 99999, result: "ghost" },
        { jsonrpc: "2.0", id: req[1].id, result: "also ok" },
      ]);
    });
    type Svc = { a(): string; b(): string };
    const client = rpcClient<Svc>({ transport });
    const [a, b] = await Promise.all([client.a(), client.b()]);
    expect(a).toBe("ok");
    expect(b).toBe("also ok");
  });

  it("single request with mismatched response ID rejects", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      return JSON.stringify({ jsonrpc: "2.0", id: 99999, result: "wrong" });
    });
    type Svc = { a(): string };
    const client = rpcClient<Svc>({ transport });
    await expect(client.a()).rejects.toThrow();
  });

  it("server returns single error object for batch → all reject", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    });
    type Svc = { a(): string; b(): string };
    const client = rpcClient<Svc>({ transport });
    const pA = client.a();
    const pB = client.b();
    await expect(pA).rejects.toThrow(RpcError);
    await expect(pB).rejects.toThrow(RpcError);
  });

  it("single call + notification in same tick → batch array", async () => {
    const calls: string[] = [];
    const transport: RpcTransport = vi.fn(async (body: string) => {
      calls.push(body);
      const req = JSON.parse(body);
      if (Array.isArray(req)) {
        const responses = req
          .filter((r: any) => "id" in r)
          .map((r: any) => ({
            jsonrpc: "2.0",
            id: r.id,
            result: "ok",
          }));
        return JSON.stringify(responses);
      }
      return JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "ok" });
    });
    type Svc = {
      getData(): string;
      logEvent(e: string): void;
    };
    const client = rpcClient<Svc>({ transport });
    const pData = client.getData();
    const pNotify = client.notify.logEvent("test");
    await Promise.all([pData, pNotify]);
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toHaveLength(2);
    // One has id, one doesn't
    const hasId = sent.filter((r: any) => "id" in r);
    const noId = sent.filter((r: any) => !("id" in r));
    expect(hasId).toHaveLength(1);
    expect(noId).toHaveLength(1);
  });

  it("notify returns Promise<void> that resolves on send", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      return JSON.stringify([]);
    });
    type Svc = { logEvent(e: string): void };
    const client = rpcClient<Svc>({ transport });
    const result = await client.notify.logEvent("test");
    expect(result).toBeUndefined();
  });

  it("notify rejects on transport error", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      throw new Error("network error");
    });
    type Svc = { logEvent(e: string): void };
    const client = rpcClient<Svc>({ transport });
    await expect(client.notify.logEvent("test")).rejects.toThrow(
      "network error"
    );
  });
});
