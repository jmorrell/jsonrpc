import { describe, it, expect, vi } from "vitest";
import {
  newWorkersWebSocketRpcResponse,
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
});
