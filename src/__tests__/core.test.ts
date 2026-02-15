import { describe, it, expect, vi } from "vitest";
import {
  isJsonRpcResponse,
  isJsonRpcRequest,
  createRequest,
  RpcError,
  processRpc,
} from "../core.js";
import { RpcProtocolError } from "../types.js";

// --- isJsonRpcResponse ---

describe("isJsonRpcResponse", () => {
  it("accepts a success response", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: 42 })).toBe(true);
  });

  it("accepts an error response", () => {
    expect(
      isJsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid Request" },
      }),
    ).toBe(true);
  });

  it("accepts null id", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: null, result: "ok" })).toBe(true);
  });

  it("rejects missing jsonrpc", () => {
    expect(isJsonRpcResponse({ id: 1, result: 42 })).toBe(false);
  });

  it("rejects wrong jsonrpc version", () => {
    expect(isJsonRpcResponse({ jsonrpc: "1.0", id: 1, result: 42 })).toBe(false);
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
      }),
    ).toBe(false);
  });

  it("rejects error response with invalid error object", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: "not an object" })).toBe(false);
  });
});

// --- isJsonRpcRequest ---

describe("isJsonRpcRequest", () => {
  it("accepts a valid request with all fields", () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: [1, 2],
      }),
    ).toBe(true);
  });

  it("accepts a valid request without params", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "add" })).toBe(true);
  });

  it("accepts a notification (no id)", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", method: "notify" })).toBe(true);
  });

  it("accepts id: null", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: null, method: "add" })).toBe(true);
  });

  it("accepts string id", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: "abc", method: "add" })).toBe(true);
  });

  it("rejects missing jsonrpc", () => {
    expect(isJsonRpcRequest({ id: 1, method: "add" })).toBe(false);
  });

  it("rejects wrong jsonrpc version", () => {
    expect(isJsonRpcRequest({ jsonrpc: "1.0", id: 1, method: "add" })).toBe(false);
  });

  it("rejects missing method", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1 })).toBe(false);
  });

  it("rejects non-string method", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: 123 })).toBe(false);
  });

  it("rejects non-array params (object)", () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: { a: 1 },
      }),
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

// --- processRpc ---

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

describe("processRpc single requests", () => {
  it("returns success for a valid call", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "add", params: [3, 4] },
      service,
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
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: 7,
    });
  });

  it("returns method not found for unknown method", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "nonexistent" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns error when handler throws", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "throws" }, service);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Something went wrong" },
    });
  });

  it("extracts code, message, data from thrown errors", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "throwsWithCode" }, service);
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
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "rpc.discover" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (constructor)", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "constructor" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (__proto__)", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "__proto__" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (toString)", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "toString" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects Object.prototype methods (hasOwnProperty)", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "hasOwnProperty" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects non-function service properties", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "notAFunction" }, service);
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
    const result = await processRpc({ jsonrpc: "1.0", id: 1, method: "add" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("rejects named params (object) with -32600", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "add", params: { a: 1, b: 2 } },
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("normalizes undefined result to null", async () => {
    const result = await processRpc({ jsonrpc: "2.0", id: 1, method: "returnsUndefined" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: null,
    });
  });

  it("calls onError with HANDLER_ERROR when handler throws", async () => {
    const onError = vi.fn();
    await processRpc({ jsonrpc: "2.0", id: 1, method: "throws" }, service, { onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RpcProtocolError);
    expect(onError.mock.calls[0][0].code).toBe("HANDLER_ERROR");
    expect(onError.mock.calls[0][0].cause).toBeInstanceOf(Error);
  });
});

// --- Notification handling ---

describe("processRpc notifications", () => {
  it("returns null for a notification (no id member)", async () => {
    const fn = vi.fn();
    const svc = { doStuff: fn };
    const result = await processRpc({ jsonrpc: "2.0", method: "doStuff", params: [1] }, svc);
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("id: null is NOT a notification — must produce a response", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: null, method: "add", params: [1, 2] },
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      result: 3,
    });
  });

  it("logs NOTIFICATION_RECEIVED via onError when notification received", async () => {
    const onError = vi.fn();
    const fn = vi.fn();
    const svc = { doStuff: fn };
    await processRpc({ jsonrpc: "2.0", method: "doStuff", params: [1] }, svc, { onError });
    expect(fn).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RpcProtocolError);
    expect(onError.mock.calls[0][0].code).toBe("NOTIFICATION_RECEIVED");
    expect(onError.mock.calls[0][0].message).toContain("notification");
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
      service,
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
      svc,
    );
    expect(result).toEqual([
      { jsonrpc: "2.0", id: 1, result: 3 },
      { jsonrpc: "2.0", id: 2, result: 2 },
    ]);
    expect(fn).not.toHaveBeenCalled();
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
      service,
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
      svc,
    );
    expect(result).toBeNull();
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  it("isolates errors: one handler throws, others succeed", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
        { jsonrpc: "2.0", id: 2, method: "throws" },
        { jsonrpc: "2.0", id: 3, method: "subtract", params: [5, 3] },
      ],
      service,
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
      svc,
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

// --- RpcProtocolError ---

describe("RpcProtocolError", () => {
  it("extends Error and has correct name", () => {
    const err = new RpcProtocolError("PARSE_ERROR", "bad json");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RpcProtocolError);
    expect(err.name).toBe("RpcProtocolError");
  });

  it("stores the error code", () => {
    const err = new RpcProtocolError("HANDLER_ERROR", "handler threw");
    expect(err.code).toBe("HANDLER_ERROR");
  });

  it("stores the cause when provided", () => {
    const cause = new TypeError("original");
    const err = new RpcProtocolError("SEND_FAILED", "send failed", { cause });
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new RpcProtocolError("UNROUTABLE_MESSAGE", "bad msg");
    expect(err.cause).toBeUndefined();
  });

  it("HANDLER_ERROR wraps the original error as cause", async () => {
    const originalError = new Error("kaboom");
    const svc = {
      explode() {
        throw originalError;
      },
    };
    const onError = vi.fn();
    await processRpc({ jsonrpc: "2.0", id: 1, method: "explode" }, svc, { onError });
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(RpcProtocolError);
    expect(err.code).toBe("HANDLER_ERROR");
    expect(err.cause).toBe(originalError);
  });

  it("NOTIFICATION_RECEIVED includes method name in message", async () => {
    const onError = vi.fn();
    await processRpc({ jsonrpc: "2.0", method: "myMethod" }, { myMethod: vi.fn() }, { onError });
    const err = onError.mock.calls[0][0];
    expect(err.code).toBe("NOTIFICATION_RECEIVED");
    expect(err.message).toContain("myMethod");
  });
});
