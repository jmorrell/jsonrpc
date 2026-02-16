import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { newWorkersRpcResponse } from "../index.js";
import { MockWebSocketPair } from "./test-helpers.js";

// Test service
const service = {
  add(a: number, b: number) {
    return a + b;
  },
  greet(name: string) {
    return `Hello, ${name}!`;
  },
};

describe("newWorkersRpcResponse convenience dispatcher (Tasks 6-7)", () => {
  beforeEach(() => {
    // Mock WebSocketPair for environment where it's not available
    if (typeof globalThis.WebSocketPair === "undefined") {
      (globalThis as any).WebSocketPair = MockWebSocketPair;
    }
  });

  afterEach(() => {
    // Clean up mock if needed
    if ((globalThis as any).WebSocketPair === MockWebSocketPair) {
      delete (globalThis as any).WebSocketPair;
    }
  });

  describe("newWorkersRpcResponse implementation", () => {
    describe("POST request with CORS header", () => {
      it("should delegate POST to newHttpBatchRpcResponse", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "add",
            params: [2, 3],
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/json");
        const json = await res.json();
        expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: 5 });
      });

      it("should add Access-Control-Allow-Origin header to POST response", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "add",
            params: [1, 1],
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });

      it("should handle parse errors with CORS header", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: "not json{",
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(200);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        const json = await res.json();
        expect(json.error.code).toBe(-32700);
      });

      it("should handle batch requests with CORS header", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify([
            { jsonrpc: "2.0", id: 1, method: "add", params: [1, 2] },
            { jsonrpc: "2.0", id: 2, method: "add", params: [3, 4] },
          ]),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(200);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json).toHaveLength(2);
        expect(json[0]).toEqual({ jsonrpc: "2.0", id: 1, result: 3 });
        expect(json[1]).toEqual({ jsonrpc: "2.0", id: 2, result: 7 });
      });

      it("should handle notifications with CORS header", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "add",
            params: [1, 2],
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        // Notification should return 204
        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });
    });

    describe("WebSocket upgrade request", () => {
      it("should route Upgrade: websocket requests to newWorkersWebSocketRpcResponse", async () => {
        // AC6.2: The dispatcher checks for Upgrade header and delegates to newWorkersWebSocketRpcResponse
        // This test verifies the routing logic attempts to create a WebSocketPair.
        // When MockWebSocketPair is set up in beforeEach, we can verify the attempt reaches the WebSocket path.

        let webSocketPairWasInstantiated = false;

        // Replace MockWebSocketPair with a tracked version
        const OriginalMockWebSocketPair = (globalThis as any).WebSocketPair;
        (globalThis as any).WebSocketPair = class extends OriginalMockWebSocketPair {
          constructor() {
            super();
            webSocketPairWasInstantiated = true;
          }
        };

        try {
          const req = new Request("http://localhost/rpc", {
            method: "GET",
            headers: {
              Upgrade: "websocket",
            },
          });

          // Call the dispatcher with WebSocket upgrade request
          try {
            await newWorkersRpcResponse(req, service);
            // If we get here without error, the status 101 Response was created successfully
            // (e.g., in a Workers environment)
          } catch (err) {
            // In Node.js, Response status 101 throws RangeError
            // But the important thing is that WebSocketPair was attempted to be instantiated,
            // which means routing worked correctly
            if (err instanceof RangeError && err.message.includes("status")) {
              // This is expected in Node.js - the routing worked but Response(101) is not allowed
            } else {
              // Some other error - re-throw if it's not what we expect
              throw err;
            }
          }

          // Verify that WebSocketPair was instantiated, proving the dispatcher routed correctly
          expect(webSocketPairWasInstantiated).toBe(true);
        } finally {
          // Restore original
          (globalThis as any).WebSocketPair = OriginalMockWebSocketPair;
        }
      });
    });

    describe("Other request types return 400", () => {
      it("should return 400 for GET request", async () => {
        const req = new Request("http://localhost/rpc", { method: "GET" });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(400);
      });

      it("should return 400 for PUT request", async () => {
        const req = new Request("http://localhost/rpc", { method: "PUT" });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(400);
      });

      it("should return 400 for DELETE request", async () => {
        const req = new Request("http://localhost/rpc", { method: "DELETE" });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(400);
      });

      it("should return 400 for PATCH request", async () => {
        const req = new Request("http://localhost/rpc", { method: "PATCH" });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(400);
      });
    });

    describe("Request priority and dispatch logic", () => {
      it("should handle POST correctly when no Upgrade header present", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "greet",
            params: ["World"],
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: "Hello, World!",
        });
      });
    });

    describe("Error handling", () => {
      it("should preserve original error responses from HTTP handler", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "nonexistent",
            params: [],
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe(-32601); // Method not found
      });

      it("should include CORS header in error responses", async () => {
        const req = new Request("http://localhost/rpc", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "nonexistent",
          }),
        });

        const res = await newWorkersRpcResponse(req, service);

        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });
    });
  });
});
