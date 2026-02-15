import { describe, it, expect, vi } from "vitest";
import { handleRpc } from "../server.js";

// Test service
const service = {
  add(a: number, b: number) {
    return a + b;
  },
};

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
    const res = await handleRpc(req, service);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: 7 });
  });
});
