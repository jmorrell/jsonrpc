import { describe, it, expect } from "vitest";
import { processRpc } from "../core.js";
import { newHttpBatchRpcResponse } from "../http-batch.js";

// Service for spec compliance tests
const service = {
  subtract(a: number, b: number) {
    return a - b;
  },
  update(..._args: any[]) {
    // no return
  },
  foobar() {
    // no return
  },
  sum(...args: number[]) {
    return args.reduce((a, b) => a + b, 0);
  },
  get_data() {
    return ["hello", 5];
  },
  notify_hello(_x: number) {
    // notification handler
  },
  notify_sum(..._args: number[]) {
    // notification handler
  },
};

describe("spec compliance: error codes", () => {
  it("-32700 Parse error (via newHttpBatchRpcResponse)", async () => {
    const req = new Request("http://localhost/rpc", {
      method: "POST",
      body: '{"jsonrpc": "2.0", "method": "foobar, "id": "1"}',
    });
    const res = await newHttpBatchRpcResponse(req, service);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(-32700);
    expect(json.error.message).toBe("Parse error");
    expect(json.id).toBeNull();
  });

  it("-32600 Invalid Request", async () => {
    const result = await processRpc({ jsonrpc: "2.0", method: 1, id: "1" }, service);
    expect(result).toMatchObject({
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("-32601 Method not found", async () => {
    const result = await processRpc({ jsonrpc: "2.0", method: "nonexistent", id: "1" }, service);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("-32602 Invalid params: named params rejected", async () => {
    // Our library only supports by-position params; named params → Invalid Request
    const result = await processRpc(
      { jsonrpc: "2.0", method: "subtract", params: { a: 1, b: 2 }, id: "1" },
      service,
    );
    // Named params make isJsonRpcRequest fail → Invalid Request
    expect(result).toMatchObject({
      error: { code: -32600 },
    });
  });

  it("-32603 Internal error: handler throws non-Error", async () => {
    const svc = {
      broken() {
        throw "just a string";
      },
    };
    const result = await processRpc({ jsonrpc: "2.0", method: "broken", id: 1 }, svc);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000 },
    });
  });
});

describe("spec compliance: ID types", () => {
  it("string id", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: "abc", method: "subtract", params: [42, 23] },
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: "abc",
      result: 19,
    });
  });

  it("number id", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: 1, method: "subtract", params: [42, 23] },
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: 19,
    });
  });

  it("null id", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", id: null, method: "subtract", params: [42, 23] },
      service,
    );
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      result: 19,
    });
  });

  it("response id is null when request id undetectable", async () => {
    const result = await processRpc("not a valid request", service);
    expect(result).toMatchObject({
      id: null,
    });
  });
});

describe("spec examples (adapted for by-position params only)", () => {
  // From spec: rpc call with positional parameters
  it("subtract(42, 23) → 19", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", method: "subtract", params: [42, 23], id: 1 },
      service,
    );
    expect(result).toEqual({ jsonrpc: "2.0", result: 19, id: 1 });
  });

  it("subtract(23, 42) → -19", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", method: "subtract", params: [23, 42], id: 2 },
      service,
    );
    expect(result).toEqual({ jsonrpc: "2.0", result: -19, id: 2 });
  });

  // Named params → rejected (our library only supports by-position)
  it("named params rejected", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", method: "subtract", params: { subtrahend: 23, minuend: 42 }, id: 3 },
      service,
    );
    expect(result).toMatchObject({ error: { code: -32600 } });
  });

  // Notification
  it("notification: no response", async () => {
    const result = await processRpc(
      { jsonrpc: "2.0", method: "update", params: [1, 2, 3, 4, 5] },
      service,
    );
    expect(result).toBeNull();
  });

  it("notification: method not found still returns null", async () => {
    const result = await processRpc({ jsonrpc: "2.0", method: "foobar" }, service);
    // notification — ignored without executing, returns null
    expect(result).toBeNull();
  });

  // Non-existent method
  it("non-existent method → -32601", async () => {
    const result = await processRpc({ jsonrpc: "2.0", method: "nonexistent", id: "1" }, service);
    expect(result).toEqual({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Method not found" },
      id: "1",
    });
  });

  // Batch examples from spec
  it("batch: spec example", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", method: "sum", params: [1, 2, 4], id: "1" },
        { jsonrpc: "2.0", method: "notify_hello", params: [7] },
        { jsonrpc: "2.0", method: "subtract", params: [42, 23], id: "2" },
        { foo: "boo" },
        { jsonrpc: "2.0", method: "foo.get", params: [{ name: "myself" }], id: "5" },
        { jsonrpc: "2.0", method: "get_data", id: "9" },
      ],
      service,
    );
    expect(Array.isArray(result)).toBe(true);
    const arr = result as any[];
    // Should have 5 responses (notification produces none)
    expect(arr).toHaveLength(5);

    // sum(1,2,4) = 7
    expect(arr.find((r: any) => r.id === "1")).toEqual({
      jsonrpc: "2.0",
      result: 7,
      id: "1",
    });

    // subtract(42,23) = 19
    expect(arr.find((r: any) => r.id === "2")).toEqual({
      jsonrpc: "2.0",
      result: 19,
      id: "2",
    });

    // {foo: "boo"} → Invalid Request
    const invalidReq = arr.find((r: any) => r.error?.code === -32600 && r.id === null);
    expect(invalidReq).toBeTruthy();

    // foo.get → Invalid Request because params is object (named params)
    // Actually foo.get has object params, which our lib rejects
    const _fooGet = arr.find((r: any) => r.id === "5");
    // This will be Invalid Request because params is an object
    // But wait - id "5" won't be in the response because isJsonRpcRequest fails (params is object)
    // So it gets id: null. Let me reconsider...
    // Actually the request has params: {name: "myself"} which is an object → isJsonRpcRequest returns false
    // → Invalid Request with id: null. But we already have one id: null entry from {foo: "boo"}.
    // So we should have two id: null entries.

    // get_data → ["hello", 5]
    expect(arr.find((r: any) => r.id === "9")).toEqual({
      jsonrpc: "2.0",
      result: ["hello", 5],
      id: "9",
    });
  });

  it("batch: all notifications → no response", async () => {
    const result = await processRpc(
      [
        { jsonrpc: "2.0", method: "notify_sum", params: [1, 2, 4] },
        { jsonrpc: "2.0", method: "notify_hello", params: [7] },
      ],
      service,
    );
    expect(result).toBeNull();
  });
});
