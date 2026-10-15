import { describe, it, expect, vi } from "vitest";
import { newHttpBatchRpcSession, newHttpBatchRpcResponse, RpcError } from "../http-batch.js";
import type { RpcRequestFn } from "../http-batch.js";

// --- Helpers ---

function mockTransport(): { transport: RpcRequestFn; calls: string[] } {
  const calls: string[] = [];
  const transport: RpcRequestFn = vi.fn(async (body: string) => {
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

const service = {
  add(a: number, b: number) {
    return a + b;
  },
};

// --- Client batching tests ---

describe("newHttpBatchRpcSession batching", () => {
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
    const transport: RpcRequestFn = vi.fn(async (body: string) => {
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
    const transport: RpcRequestFn = vi.fn(async (body: string) => {
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
    const transport: RpcRequestFn = vi.fn(async () => {
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
    const transport: RpcRequestFn = vi.fn(async (body: string) => {
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
    const transport: RpcRequestFn = vi.fn(async (body: string) => {
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
    const transport: RpcRequestFn = vi.fn(async () => {
      return JSON.stringify({ jsonrpc: "2.0", id: 99999, result: "wrong" });
    });
    type Svc = { a(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });
    await expect(client.a()).rejects.toThrow();
  });

  it("server returns single error object for batch → all reject", async () => {
    const transport: RpcRequestFn = vi.fn(async () => {
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

// --- Symbol.dispose tests ---

describe("newHttpBatchRpcSession Symbol.dispose", () => {
  it("has Symbol.dispose property", async () => {
    const { transport } = mockTransport();
    type Svc = { test(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });

    expect(typeof client[Symbol.dispose]).toBe("function");
  });

  it("Symbol.dispose can be called without throwing", async () => {
    const { transport } = mockTransport();
    type Svc = { test(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });

    expect(() => {
      client[Symbol.dispose]();
    }).not.toThrow();
  });

  it("Symbol.dispose is non-enumerable", async () => {
    const { transport } = mockTransport();
    type Svc = { test(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });

    expect(Object.keys(client)).toHaveLength(0);
  });

  it("spreading the proxy does not include Symbol.dispose", async () => {
    const { transport } = mockTransport();
    type Svc = { test(): string };
    const client = newHttpBatchRpcSession<Svc>({ transport });

    const spread = { ...client };
    expect(Object.keys(spread)).toHaveLength(0);
    expect(Symbol.dispose in spread).toBe(false);
  });
});

// --- Server HTTP handler tests ---

describe("newHttpBatchRpcResponse", () => {
  it("returns 405 for non-POST requests", async () => {
    const req = new Request("http://localhost/rpc", { method: "GET" });
    const res = await newHttpBatchRpcResponse(req, service);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("returns Parse error for invalid JSON", async () => {
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: "not json{",
    });
    const res = await newHttpBatchRpcResponse(req, service);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("returns correct Content-Type header", async () => {
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] }),
    });
    const res = await newHttpBatchRpcResponse(req, service);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns 204 for notification", async () => {
    const fn = vi.fn();
    const svc = { doStuff: fn };
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "doStuff" }),
    });
    const res = await newHttpBatchRpcResponse(req, svc);
    expect(res.status).toBe(204);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns 200 with JSON body for normal request", async () => {
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: [3, 4],
      }),
    });
    const res = await newHttpBatchRpcResponse(req, service);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: 7 });
  });
});

describe("HTTP error explanations", () => {
  it("preserves the server's upload limit explanation for every call in a rejected batch", async () => {
    let fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { error: "Request body exceeds the upload limit", maxBytes: 2097152 },
          { status: 413 },
        ),
      );
    using client = newHttpBatchRpcSession<{ add(a: number, b: number): number }>(
      "https://example.com/jsonrpc",
    );
    try {
      let results = await Promise.allSettled([client.add(1, 2), client.add(3, 4)]);
      expect(results).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            code: 413,
            message: "Request body exceeds the upload limit",
          }),
        },
        {
          status: "rejected",
          reason: expect.objectContaining({
            code: 413,
            message: "Request body exceeds the upload limit",
          }),
        },
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it.each([
    ["text/html", '{"error":"private proxy diagnostic"}'],
    ["application/json", "not JSON"],
    ["application/json", '{"error":{"stack":"private"}}'],
    ["application/json", '{"error":"   "}'],
  ])("uses a nonempty status fallback for unusable %s responses", async (contentType, body) => {
    let fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(body, { status: 503, headers: { "Content-Type": contentType } }),
      );
    using client = newHttpBatchRpcSession<{ add(a: number, b: number): number }>(
      "https://example.com/jsonrpc",
    );
    try {
      await expect(client.add(1, 2)).rejects.toMatchObject({
        code: 503,
        message: "Request failed (HTTP 503).",
      });
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("public handler errors", () => {
  it("serializes batch failures without losing diagnostics or changing protocol errors", async () => {
    const unexpected = Object.assign(new Error("private database detail"), { data: "private" });
    const onError = vi.fn();
    const service = {
      expected() {
        throw new RpcError("Choose another name", -32009, { field: "name" });
      },
      unexpected() {
        throw unexpected;
      },
      nonError() {
        throw "private thrown string";
      },
      success() {
        return 42;
      },
    };
    const response = await newHttpBatchRpcResponse(
      new Request("https://example.com/rpc", {
        method: "POST",
        body: JSON.stringify(
          ["expected", "unexpected", "nonError", "success", "missing"].map((method, id) => ({
            jsonrpc: "2.0",
            id,
            method,
          })),
        ),
      }),
      service,
      {
        onError,
        serializeError(error, method) {
          if (error instanceof RpcError)
            return { code: error.code, message: error.message, data: error.data };
          return { code: -32603, message: `Could not complete ${method}. Check its result.` };
        },
      },
    );
    expect(await response.json()).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        error: { code: -32009, message: "Choose another name", data: { field: "name" } },
      },
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Could not complete unexpected. Check its result." },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32603, message: "Could not complete nonError. Check its result." },
      },
      { jsonrpc: "2.0", id: 3, result: 42 },
      { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "Method not found" } },
    ]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HANDLER_ERROR", cause: unexpected }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HANDLER_ERROR", cause: "private thrown string" }),
    );
  });
});
