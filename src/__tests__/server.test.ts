import { describe, it, expect, vi } from "vitest";
import { processRpc, handleRpc, isJsonRpcRequest } from "../server.js";

// Test service
const service = {
  add(a: number, b: number) {
    return a + b;
  },
  subtract(a: number, b: number) {
    return a - b;
  },
  greet(name: string) {
    return `Hello, ${name}!`;
  },
  throws() {
    throw new Error("Something went wrong");
  },
  throwsWithCode() {
    const err = new Error("Custom error");
    (err as any).code = 42;
    (err as any).data = { detail: "extra info" };
    throw err;
  },
  returnsUndefined() {
    return undefined;
  },
  async asyncAdd(a: number, b: number) {
    return a + b;
  },
  notAFunction: 42 as any,
};

// --- isJsonRpcRequest ---

describe("isJsonRpcRequest", () => {
  it("accepts a valid request with all fields", () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: [1, 2],
      })
    ).toBe(true);
  });

  it("accepts a valid request without params", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "add" })
    ).toBe(true);
  });

  it("accepts a notification (no id)", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", method: "notify" })
    ).toBe(true);
  });

  it("accepts id: null", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: null, method: "add" })
    ).toBe(true);
  });

  it("accepts string id", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: "abc", method: "add" })
    ).toBe(true);
  });

  it("rejects missing jsonrpc", () => {
    expect(isJsonRpcRequest({ id: 1, method: "add" })).toBe(false);
  });

  it("rejects wrong jsonrpc version", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "1.0", id: 1, method: "add" })
    ).toBe(false);
  });

  it("rejects missing method", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1 })).toBe(false);
  });

  it("rejects non-string method", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: 123 })
    ).toBe(false);
  });

  it("rejects non-array params (object)", () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: { a: 1 },
      })
    ).toBe(false);
  });

  it("rejects null", () => {
    expect(isJsonRpcRequest(null)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isJsonRpcRequest(42)).toBe(false);
    expect(isJsonRpcRequest("hello")).toBe(false);
    expect(isJsonRpcRequest(true)).toBe(false);
  });
});

// --- processRpc single requests ---

describe("processRpc single requests", () => {
  it("returns success for a valid call", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "add", params: [3, 4] },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: 7,
    });
  });

  it("returns success for an async method", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "asyncAdd", params: [3, 4] },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: 7,
    });
  });

  it("returns method not found for unknown method", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "nonexistent" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns error when handler throws", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "throws" },
      service
    );
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Something went wrong" },
    });
  });

  it("extracts code, message, data from thrown errors", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "throwsWithCode" },
      service
    );
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: 42,
        message: "Custom error",
        data: { detail: "extra info" },
      },
    });
  });

  it("rejects rpc.-prefixed methods", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "rpc.discover" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (constructor)", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "constructor" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (__proto__)", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "__proto__" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (toString)", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "toString" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (hasOwnProperty)", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "hasOwnProperty" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects non-function service properties", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "notAFunction" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns Invalid Request for primitives as input", async () => {
    for (const input of [42, "hello", true, null]) {
      const result = await processRpc(input, service);
      expect(result).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }
  });

  it("returns Invalid Request for invalid request objects", async () => {
    const result = await processRpc(
      { jsonrpc: "1.0", id: 1, method: "add" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("rejects named params (object) with -32602", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "add", params: { a: 1, b: 2 } },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("normalizes undefined result to null", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "returnsUndefined" },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: null,
    });
  });

  it("calls onError when handler throws", async () => {
    const onError = vi.fn();
    await processRpc(
      { jsonrpc: "2.0", id: 1, method: "throws" },
      service,
      { onError }
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// --- Notification handling ---

describe("processRpc notifications", () => {
  it("returns null for a notification (no id member)", async () => {
    const fn = vi.fn();
    const svc = { doStuff: fn };
    const result = await processRpc(
      { jsonrpc: "2.0", method: "doStuff", params: [1] },
      svc
    );
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("id: null is NOT a notification — must produce a response", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: null, method: "add", params: [1, 2] },
      service
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      result: 3,
    });
  });

  it("still executes method for notifications even if it throws", async () => {
    const fn = vi.fn(() => {
      throw new Error("oops");
    });
    const svc = { doStuff: fn };
    const result = await processRpc(
      { jsonrpc: "2.0", method: "doStuff" },
      svc
    );
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledOnce();
  });
});

// --- handleRpc HTTP wrapper ---

describe("handleRpc HTTP wrapper", () => {
  it("returns 405 for non-POST requests", async () => {
    const req = new Request("http://localhost/rpc", { method: "GET" });
    const res = await handleRpc(req, service);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("returns Parse error for invalid JSON", async () => {
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: "not json{",
    });
    const res = await handleRpc(req, service);
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
    const res = await handleRpc(req, service);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns 204 for notification", async () => {
    const fn = vi.fn();
    const svc = { doStuff: fn };
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "doStuff" }),
    });
    const res = await handleRpc(req, svc);
    expect(res.status).toBe(204);
    expect(fn).toHaveBeenCalledOnce();
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
    const res = await handleRpc(req, service);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: 7 });
  });
});

// --- Batch tests ---

describe("processRpc batch", () => {
  it("processes array of valid requests", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
        { jsonrpc: "2.0", id: 2, method: "subtract", params: [5, 3] },
      ],
      service
    );
    expect(result).toEqual([
      { jsonrpc: "2.0", id: 1, result: 3 },
      { jsonrpc: "2.0", id: 2, result: 2 },
    ]);
  });

  it("returns responses only for non-notifications in mixed batch", async () => {
    const fn = vi.fn();
    const svc = { ...service, logEvent: fn };
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
        { jsonrpc: "2.0", method: "logEvent", params: ["test"] },
        { jsonrpc: "2.0", id: 2, method: "subtract", params: [5, 3] },
      ],
      svc
    );
    expect(result).toEqual([
      { jsonrpc: "2.0", id: 1, result: 3 },
      { jsonrpc: "2.0", id: 2, result: 2 },
    ]);
    expect(fn).toHaveBeenCalledWith("test");
  });

  it("returns Invalid Request error for empty array", async () => {
    const result = await processRpc([], service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("returns array of Invalid Request errors for non-object items", async () => {
    const result = await processRpc([1, 2, 3], service);
    expect(result).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    ]);
  });

  it("handles mixed valid and invalid items in batch", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
        42,
        { jsonrpc: "2.0", id: 2, method: "subtract", params: [5, 3] },
      ],
      service
    );
    expect(result).toEqual([
      { jsonrpc: "2.0", id: 1, result: 3 },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 2, result: 2 },
    ]);
  });

  it("returns null for all-notification batch", async () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const svc = { a: fn1, b: fn2 };
    const result = await processRpc(
      [
        { jsonrpc: "2.0", method: "a" },
        { jsonrpc: "2.0", method: "b" },
      ],
      svc
    );
    expect(result).toBeNull();
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("isolates errors: one handler throws, others succeed", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
        { jsonrpc: "2.0", id: 2, method: "throws" },
        { jsonrpc: "2.0", id: 3, method: "subtract", params: [5, 3] },
      ],
      service
    );
    expect(result).toHaveLength(3);
    expect((result as any)[0]).toEqual({ jsonrpc: "2.0", id: 1, result: 3 });
    expect((result as any)[1]).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32000, message: "Something went wrong" },
    });
    expect((result as any)[2]).toEqual({ jsonrpc: "2.0", id: 3, result: 2 });
  });

  it("executes batch items concurrently", async () => {
    const order: number[] = [];
    const svc = {
      async slow() {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        order.push(3);
        return "slow";
      },
      async fast() {
        order.push(2);
        return "fast";
      },
    };
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "slow" },
        { jsonrpc: "2.0", id: 2, method: "fast" },
      ],
      svc
    );
    expect(result).toEqual([
      { jsonrpc: "2.0", id: 1, result: "slow" },
      { jsonrpc: "2.0", id: 2, result: "fast" },
    ]);
    // Both start before slow finishes
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(2);
  });
});
