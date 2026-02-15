import { describe, it, expect, vi } from "vitest";
import { newHttpBatchRpcSession, RpcError } from "../http-batch.js";
import type { RpcTransport } from "../http-batch.js";

// --- Client batching tests ---

describe("newHttpBatchRpcSession batching", () => {
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
    const pOk = client.ok();
    const pFail = client.fail();
    expect(await pOk).toBe("ok");
    await expect(pFail).rejects.toThrow(RpcError);
    await expect(pFail).rejects.toMatchObject({
      code: -32000,
      message: "fail",
    });
  });

  it("transport failure rejects all promises in batch", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      throw new Error("network error");
    });
    type Svc = { a(): string; b(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });
    const pA = client.a();
    const pB = client.b();
    await expect(pA).rejects.toThrow("network error");
    await expect(pB).rejects.toThrow("network error");
  });

  it("fewer responses than requests rejects unmatched promises", async () => {
    const transport: RpcTransport = vi.fn(async (body: string) => {
      const req = JSON.parse(body);
      // Only respond to first request
      return JSON.stringify([{ jsonrpc: "2.0", id: req[0].id, result: "ok" }]);
    });
    type Svc = { a(): string; b(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
    const [a, b] = await Promise.all([client.a(), client.b()]);
    expect(a).toBe("ok");
    expect(b).toBe("also ok");
  });

  it("single request with mismatched response ID rejects", async () => {
    const transport: RpcTransport = vi.fn(async () => {
      return JSON.stringify({ jsonrpc: "2.0", id: 99999, result: "wrong" });
    });
    type Svc = { a(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });
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
    const client = newHttpBatchRpcSession<Svc>({ transport });
    const pA = client.a();
    const pB = client.b();
    await expect(pA).rejects.toThrow(RpcError);
    await expect(pB).rejects.toThrow(RpcError);
  });
});
