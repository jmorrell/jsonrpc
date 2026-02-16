import { describe, it, expect, vi } from "vitest";
import {
  newWorkersWebSocketRpcResponse,
  newWebSocketRpcSession,
  createWebSocketTransport,
} from "../websocket.js";
import { createLinkedTransports, MockWebSocket } from "./test-helpers.js";
import { rpcSession } from "../session.js";

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

    it("should accept existing WebSocket instance", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      expect(session).toBeDefined();
    });

    it("should have Symbol.dispose property", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      // Test that Symbol.dispose is accessible through the proxy
      expect(typeof (session as any)[Symbol.dispose]).toBe("function");
    });

    it("should close WebSocket when Symbol.dispose is called", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const closeSpy = vi.spyOn(ws, "close");

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      // Call dispose via symbol
      (session as any)[Symbol.dispose]();

      expect(closeSpy).toHaveBeenCalled();
    });

    it("should have close() method", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      expect(typeof (session as any).close).toBe("function");
    });

    it("should close WebSocket when close() is called", () => {
      const ws = new MockWebSocket(WebSocket.OPEN);
      const closeSpy = vi.spyOn(ws, "close");

      const session = newWebSocketRpcSession<{ test: () => Promise<string> }>(ws);

      (session as any).close();

      expect(closeSpy).toHaveBeenCalled();
    });

    it("should support bidirectional RPC with localFunctions", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const serverService = {
        greet: async (name: string) => `Hello, ${name}!`,
      };

      const clientLocalFunctions = {
        onNotification: async (message: string) => `Received: ${message}`,
      };

      // Create server session
      const serverSession = rpcSession(transportA, serverService, {
        role: "acceptor",
      });

      // Create client session with local functions
      const clientSession = rpcSession(transportB, clientLocalFunctions, {
        role: "initiator",
      });

      // Client should be able to call server's greet method
      const greeting = await (clientSession.remote as any).greet("Alice");
      expect(greeting).toBe("Hello, Alice!");

      // Server should be able to call client's onNotification
      const notification = await (serverSession.remote as any).onNotification("Hello from server");
      expect(notification).toBe("Received: Hello from server");

      serverSession.close();
      clientSession.close();
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

  describe("WebSocket bidirectional RPC", () => {
    it("should handle server → client method calls", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const clientService = {
        getData: async () => ({ value: 42 }),
      };

      const serverService = {
        compute: async () => "done",
      };

      const serverSession = rpcSession(transportA, serverService, {
        role: "acceptor",
      });
      const clientSession = rpcSession(transportB, clientService, {
        role: "initiator",
      });

      // Server invokes a method on the client
      const result = await (serverSession.remote as any).getData();
      expect(result).toEqual({ value: 42 });

      // Verify client can also call server
      const serverResult = await (clientSession.remote as any).compute();
      expect(serverResult).toBe("done");

      serverSession.close();
      clientSession.close();
    });
  });
});
