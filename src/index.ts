// src/index.ts

// HTTP batch transport
export {
  newHttpBatchRpcResponse,
  newHttpBatchRpcSession,
} from "./http-batch.js";
export type { RpcTransport, RpcFetchOptions, RpcClientOptions } from "./http-batch.js";

// Core types and errors
export { RpcError, RpcProtocolError } from "./core.js";
export type {
  RpcProtocolErrorCode,
  RpcHandlerOptions,
  PromisifyMethods,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from "./core.js";
