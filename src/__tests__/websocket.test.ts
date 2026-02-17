import { describe, it, expect, vi } from "vitest";
import {
  newWorkersWebSocketRpcResponse,
  newWorkersWebSocketRpcSession,
  newWebSocketRpcSession,
  createWebSocketTransport,
} from "../websocket.js";

describe("WebSocket transport and RPC", () => {
  describe("newWorkersWebSocketRpcResponse", () => {
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
  });

  describe("newWorkersWebSocketRpcSession", () => {
    it("should return 400 response for non-upgrade requests", () => {
      const request = new Request("http://example.com", { method: "GET" });
      const { response } = newWorkersWebSocketRpcSession(request);

      expect(response.status).toBe(400);
    });

    it("should return a closed session that allows dispose/close on non-upgrade requests", () => {
      const request = new Request("http://example.com", { method: "GET" });
      const { session } = newWorkersWebSocketRpcSession(request);

      // dispose and close should be no-ops, not throw
      expect(() => session[Symbol.dispose]()).not.toThrow();
      expect(() => session.close()).not.toThrow();
    });

    it("should return a closed session that rejects calls for non-upgrade requests", async () => {
      const request = new Request("http://example.com", { method: "GET" });
      const { session } = newWorkersWebSocketRpcSession<{ add(a: number, b: number): number }>(
        request,
      );

      await expect(session.remote.add(1, 2)).rejects.toThrow();
    });
  });
});
