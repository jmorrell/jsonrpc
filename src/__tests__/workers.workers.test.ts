import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import {
  newHttpBatchRpcResponse,
  newHttpBatchRpcSession,
  newWorkersWebSocketRpcResponse,
  newWebSocketRpcSession,
  newWorkersRpcResponse,
  RpcError,
  RpcProtocolError,
} from "../index.js";

describe("All 7 exports resolve from entry point", () => {
  it("should export all 7 required symbols with correct types", () => {
    // newHttpBatchRpcResponse (function)
    expect(typeof newHttpBatchRpcResponse).toBe("function");

    // newHttpBatchRpcSession (function)
    expect(typeof newHttpBatchRpcSession).toBe("function");

    // newWorkersWebSocketRpcResponse (function)
    expect(typeof newWorkersWebSocketRpcResponse).toBe("function");

    // newWebSocketRpcSession (function)
    expect(typeof newWebSocketRpcSession).toBe("function");

    // newWorkersRpcResponse (function)
    expect(typeof newWorkersRpcResponse).toBe("function");

    // RpcError (class/constructor)
    expect(typeof RpcError).toBe("function");

    // RpcProtocolError (class/constructor)
    expect(typeof RpcProtocolError).toBe("function");
  });

  it("should instantiate RpcError with message", () => {
    const error = new RpcError("test error");
    expect(error).toBeInstanceOf(RpcError);
    expect(error.message).toBe("test error");
  });

  it("should instantiate RpcProtocolError with message", () => {
    const error = new RpcProtocolError(-32700, "protocol error");
    expect(error).toBeInstanceOf(RpcProtocolError);
    expect(error.message).toBe("protocol error");
    expect(error.code).toBe(-32700);
  });
});

describe("Workers runtime integration tests (Task 5)", () => {
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

      const data = await response.json();
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

      const data = await response.json();
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
        const timeout = setTimeout(
          () => reject(new Error("WebSocket response timeout")),
          5000,
        );

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
      const response = await SELF.fetch("http://localhost/rpc", {
        method: "GET",
        headers: {
          Upgrade: "websocket",
        },
      });

      const ws = response.webSocket;

      if (!ws) {
        throw new Error("WebSocket not available");
      }

      ws.accept();

      // Send first request
      const req1 = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: ["first"],
      });

      ws.send(req1);

      // Send second request
      const req2 = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "echo",
        params: ["second"],
      });

      ws.send(req2);

      // Collect both responses
      const responses: string[] = [];
      const collectResponses = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WebSocket collection timeout")),
          5000,
        );

        let receivedCount = 0;

        const messageHandler = (event: Event) => {
          if (event instanceof MessageEvent) {
            responses.push(event.data);
            receivedCount++;

            if (receivedCount === 2) {
              clearTimeout(timeout);
              ws.removeEventListener("message", messageHandler);
              resolve();
            }
          }
        };

        ws.addEventListener("message", messageHandler);
      });

      await collectResponses;

      expect(responses).toHaveLength(2);

      const resp1 = JSON.parse(responses[0]);
      const resp2 = JSON.parse(responses[1]);

      expect(resp1).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: ["first"],
      });

      expect(resp2).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: ["second"],
      });

      ws.close();
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
