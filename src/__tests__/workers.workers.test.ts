import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import {
  newHttpBatchRpcResponse,
  newHttpBatchRpcSession,
  newWorkersWebSocketRpcResponse,
  newWorkersWebSocketRpcSession,
  newWebSocketRpcSession,
  newWorkersRpcResponse,
  RpcError,
  RpcProtocolError,
} from "../index.js";

describe("All exports resolve from entry point", () => {
  it("should export all required symbols with correct types", () => {
    // newHttpBatchRpcResponse (function)
    expect(typeof newHttpBatchRpcResponse).toBe("function");

    // newHttpBatchRpcSession (function)
    expect(typeof newHttpBatchRpcSession).toBe("function");

    // newWorkersWebSocketRpcResponse (function)
    expect(typeof newWorkersWebSocketRpcResponse).toBe("function");

    // newWorkersWebSocketRpcSession (function)
    expect(typeof newWorkersWebSocketRpcSession).toBe("function");

    // newWebSocketRpcSession (function)
    expect(typeof newWebSocketRpcSession).toBe("function");

    // newWorkersRpcResponse (function)
    expect(typeof newWorkersRpcResponse).toBe("function");

    // RpcError (class/constructor)
    expect(typeof RpcError).toBe("function");

    // RpcProtocolError (class/constructor)
    expect(typeof RpcProtocolError).toBe("function");
  });

  it("should instantiate RpcError with message and code", () => {
    const error = new RpcError("test error", -32600);
    expect(error).toBeInstanceOf(RpcError);
    expect(error.message).toBe("test error");
    expect(error.code).toBe(-32600);
  });

  it("should instantiate RpcProtocolError with code and message", () => {
    const error = new RpcProtocolError("PARSE_ERROR", "protocol error");
    expect(error).toBeInstanceOf(RpcProtocolError);
    expect(error.message).toBe("protocol error");
    expect(error.code).toBe("PARSE_ERROR");
  });
});

describe("Workers runtime integration tests", () => {
  describe("HTTP batch functionality in Workers", () => {
    it("should handle single HTTP batch request round-trip", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "add",
          params: [2, 3],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const data = await response.json();
      expect(data).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: 5,
      });
    });

    it("should handle batch auto-batching with multiple requests", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
          { jsonrpc: "2.0", id: 2, method: "add", params: [3, 4] },
          { jsonrpc: "2.0", id: 3, method: "greet", params: ["World"] },
        ]),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as any; // Response.json() returns unknown
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(3);
      expect(data[0]).toEqual({ jsonrpc: "2.0", id: 1, result: 3 });
      expect(data[1]).toEqual({ jsonrpc: "2.0", id: 2, result: 7 });
      expect(data[2]).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: "Hello, World!",
      });
    });

    it("should propagate error for unknown method", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "unknownMethod",
          params: [],
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as any; // Response.json() returns unknown
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32601); // Method not found
    });

    it("should include CORS header on POST response", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "add",
          params: [1, 1],
        }),
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should return 400 for GET request (non-POST)", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "GET",
      });

      expect(response.status).toBe(400);
    });

    it("should not return 405 for non-POST (dispatcher returns 400)", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
      // Note: dispatcher returns 400, not 405 (405 comes from newHttpBatchRpcResponse directly)
    });
  });

  describe("WebSocket functionality in Workers", () => {
    it("should upgrade WebSocket connection with 101 response", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "GET",
        headers: {
          Upgrade: "websocket",
        },
      });

      expect(response.status).toBe(101);
    });

    it("should handle WebSocket RPC round-trip", async () => {
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "GET",
        headers: {
          Upgrade: "websocket",
        },
      });

      expect(response.status).toBe(101);

      // Get the client WebSocket from response
      const ws = response.webSocket;
      expect(ws).toBeDefined();

      if (!ws) {
        throw new Error("WebSocket not available in response");
      }

      ws.accept();

      // Send a JSON-RPC request
      const rpcRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: [5, 3],
      });

      ws.send(rpcRequest);

      // Listen for response with timeout
      const responsePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket response timeout")), 5000);

        const messageHandler = (event: Event) => {
          if (event instanceof MessageEvent) {
            clearTimeout(timeout);
            ws.removeEventListener("message", messageHandler);
            resolve(event.data);
          }
        };

        ws.addEventListener("message", messageHandler);
      });

      const responseData = await responsePromise;
      const parsed = JSON.parse(responseData);

      expect(parsed).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: 8,
      });

      ws.close();
    });

    it("should support bidirectional communication over WebSocket", async () => {
      const response = await SELF.fetch("http://localhost/bidirectional", {
        method: "GET",
        headers: {
          Upgrade: "websocket",
        },
      });

      const ws = response.webSocket;
      if (!ws) throw new Error("WebSocket not available");
      ws.accept();

      // Create client session with a local function the server can call back
      const client = newWebSocketRpcSession<
        { addWithClientMultiplier(a: number, b: number): number },
        { getMultiplier(): number }
      >(ws, {
        getMultiplier: () => 10,
      });

      // Client calls server, server calls client.getMultiplier() mid-request
      const result = await client.addWithClientMultiplier(2, 3);

      // (2 + 3) * 10 = 50
      expect(result).toBe(50);

      client.close();
    });
  });

  describe("WebSocket session lifecycle", () => {
    function createWebSocketSession<T extends object>() {
      return SELF.fetch("http://localhost/rpc", {
        method: "GET",
        headers: { Upgrade: "websocket" },
      }).then((response) => {
        const ws = response.webSocket;
        if (!ws) throw new Error("WebSocket not available");
        ws.accept();
        return newWebSocketRpcSession<T>(ws);
      });
    }

    it("should have Symbol.dispose property", async () => {
      const session = await createWebSocketSession<{ add(a: number, b: number): number }>();
      expect(typeof session[Symbol.dispose]).toBe("function");
      session.close();
    });

    it("should close session via Symbol.dispose", async () => {
      const session = await createWebSocketSession<{ add(a: number, b: number): number }>();

      // Verify session works
      const result = await session.add(1, 2);
      expect(result).toBe(3);

      // Dispose
      session[Symbol.dispose]();

      // Session should be closed
      await expect(session.add(1, 2)).rejects.toThrow();
    });

    it("should close session via close()", async () => {
      const session = await createWebSocketSession<{ add(a: number, b: number): number }>();

      // Verify session works
      const result = await session.add(1, 2);
      expect(result).toBe(3);

      session.close();

      // Session should be closed
      await expect(session.add(1, 2)).rejects.toThrow();
    });
  });

  describe("Symbol.dispose in Workers runtime", () => {
    it("should have Symbol.dispose as a function on HTTP batch proxy", async () => {
      const session = newHttpBatchRpcSession({
        url: "http://localhost:8000",
        transport: async (body: string) => {
          const response = await SELF.fetch("http://localhost/rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          return response.text();
        },
      });

      // Verify Symbol.dispose is a function on the proxy
      expect(typeof session[Symbol.dispose]).toBe("function");

      // Clean up
      session[Symbol.dispose]();
    });
  });
});
