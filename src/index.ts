// src/index.ts

// HTTP batch transport
export { newHttpBatchRpcResponse, newHttpBatchRpcSession } from "./http-batch.js";
export type { RpcRequestFn, RpcFetchOptions, RpcClientOptions } from "./http-batch.js";

// WebSocket transport
export { newWorkersWebSocketRpcResponse, newWebSocketRpcSession } from "./websocket.js";

// Core types and errors
export { processRpc, RpcError, RpcProtocolError } from "./core.js";
export type {
  RpcProtocolErrorCode,
  RpcHandlerOptions,
  PromisifyMethods,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from "./core.js";

// Convenience dispatcher
import { newHttpBatchRpcResponse } from "./http-batch.js";
import { newWorkersWebSocketRpcResponse } from "./websocket.js";
import type { RpcHandlerOptions } from "./core.js";

/**
 * Convenience dispatcher for Cloudflare Workers.
 * Routes POST → HTTP batch (with CORS), Upgrade → WebSocket, else → 400.
 *
 * @param request - The HTTP request
 * @param service - The service object with methods to expose
 * @param options - RPC handler options
 * @returns A Response with appropriate status and headers
 */
export async function newWorkersRpcResponse<T extends object>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions,
): Promise<Response> {
  // WebSocket upgrade
  if (request.headers.get("Upgrade") === "websocket") {
    return newWorkersWebSocketRpcResponse(request, service, options);
  }

  // HTTP POST → batch with CORS
  if (request.method === "POST") {
    const response = await newHttpBatchRpcResponse(request, service, options);
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  // Anything else → 400
  return new Response("Bad Request", { status: 400 });
}
