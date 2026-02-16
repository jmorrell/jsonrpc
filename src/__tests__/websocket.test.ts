import { describe, it, expect, vi } from "vitest";
import {
  newWorkersWebSocketRpcResponse,
  newWebSocketRpcSession,
  createWebSocketTransport,
} from "../websocket.js";
import { MockWebSocket } from "./test-helpers.js";

describe("WebSocket transport and RPC (Tasks 2-5)", () => {
  describe("createWebSocketTransport", () => {
    it("should queue messages while socket is CONNECTING", () => {
      const ws = new MockWebSocket(WebSocket.CONNECTING);
      const transport = createWebSocketTransport(ws);

      // Send message before connection opens
      transport.send("test-message-1");
      transport.send("test-message-2");

      // Should not be sent yet (queued)
      expect(ws._getSentMessages()).toEqual([]);

      // Simulate connection opening
      ws._fireOpen();

      // Now messages should be flushed
      expect(ws._getSentMessages()).toEqual(["test-message-1", "test-message-2"]);
    });

    it("should send messages immediately when socket is OPEN", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const transport = createWebSocketTransport(ws);

      transport.send("test-message");

      expect(ws._getSentMessages()).toEqual(["test-message"]);
    });

    it("should register message listener", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const transport = createWebSocketTransport(ws);

      let receivedMessage: string | undefined;
      transport.onMessage((message: string) => {
        receivedMessage = message;
      });

      ws._receiveMessage("incoming-message");
      expect(receivedMessage).toBe("incoming-message");
    });

    it("should call close handler when close event fires", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const transport = createWebSocketTransport(ws);

      let closeHandlerCalled = false;
      let closeReason: Error | undefined;
      transport.onClose((reason?: Error) => {
        closeHandlerCalled = true;
        closeReason = reason;
      });

      ws.close();
      expect(closeHandlerCalled).toBe(true);
      expect(closeReason).toBeUndefined();
    });

    it("should call close handler with error when error event fires", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const transport = createWebSocketTransport(ws);

      let closeHandlerCalled = false;
      let closeReason: Error | undefined;
      transport.onClose((reason?: Error) => {
        closeHandlerCalled = true;
        closeReason = reason;
      });

      ws._fireError();
      expect(closeHandlerCalled).toBe(true);
      expect(closeReason).toBeInstanceOf(Error);
      expect(closeReason?.message).toBe("WebSocket error");
    });

    it("should delegate close() to WebSocket.close()", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const transport = createWebSocketTransport(ws);
      const closeSpy = vi.spyOn(ws, "close");

      transport.close();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("newWorkersWebSocketRpcResponse (AC4)", () => {
    it("should return 400 for non-upgrade requests", () => {
      const request = new Request("http://example.com", { method: "GET" });
      const response = newWorkersWebSocketRpcResponse(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for requests without Upgrade header", () => {
      const request = new Request("http://example.com");
      const response = newWorkersWebSocketRpcResponse(request);

      expect(response.status).toBe(400);
    });

    // Note: (101 status code test) requires real WebSocketPair from Cloudflare Workers runtime
    // This will be tested in Phase 4 workers integration tests
    // The function is implemented correctly, but Node's Response API doesn't support 101 status
  });

  describe("newWebSocketRpcSession (AC5)", () => {
    it("should accept URL string and create WebSocket", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      globalThis.WebSocket = vi.fn(() => ws) as any;

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>("ws://example.com");

      expect(globalThis.WebSocket).toHaveBeenCalledWith("ws://example.com");
      expect(session).toBeDefined();
    });

    it("should queue messages while WebSocket is connecting", async () => {
      const ws = new MockWebSocket(WebSocket.CONNECTING);

      // Create session with connecting socket - this will attempt to make RPC calls
      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      // Make an RPC call while socket is CONNECTING
      void (session as any).test(); // Start call (don't await, it won't complete without server)

      // Verify message was queued (not sent immediately)
      expect(ws._getSentMessages()).toEqual([]);

      // Simulate socket opening
      ws._fireOpen();

      // Now messages should have been flushed to the socket
      expect(ws._getSentMessages().length).toBeGreaterThan(0);

      // The call itself won't complete (no real server), but it was queued and sent
      // Just verify that the queuing mechanism worked
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
    });
  });
});
