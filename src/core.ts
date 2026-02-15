// pattern: Functional Core

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  JsonRpcSuccessResponse,
  RpcHandlerOptions,
} from "./types.js";

/**
 * Type guard to check if a given object is a valid JSON-RPC response.
 */
export function isJsonRpcResponse(res: unknown): res is JsonRpcResponse {
  if (typeof res !== "object" || res === null) return false;
  if (!("jsonrpc" in res) || (res as any).jsonrpc !== "2.0") return false; // narrowing unknown in type guard
  if (
    !("id" in res) ||
    (typeof (res as any).id !== "string" && // narrowing unknown in type guard
      typeof (res as any).id !== "number" &&
      (res as any).id !== null)
  )
    return false;

  if ("result" in res) {
    return !("error" in res);
  } else if ("error" in res) {
    const error = (res as JsonRpcErrorResponse).error;
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number" &&
      "message" in error &&
      typeof error.message === "string"
    );
  }

  return false;
}

/**
 * Error class thrown when a remote method returns a JSON-RPC error.
 */
export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

/**
 * Create a JsonRpcRequest. If idGenerator is not provided, the request will have no id field.
 */
export function createRequest(
  method: string,
  params?: unknown[],
  idGenerator?: () => number | string
): JsonRpcRequest {
  const req: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
  };

  if (idGenerator) {
    req.id = idGenerator();
  }

  if (params && params.length > 0) {
    req.params = params;
  }

  return req;
}

/**
 * Type guard to check if a given object is a valid JSON-RPC 2.0 request.
 * Only accepts by-position params (arrays). Named params (objects) are rejected.
 */
export function isJsonRpcRequest(req: unknown): req is JsonRpcRequest {
  if (typeof req !== "object" || req === null) return false;
  const r = req as Record<string, unknown>;
  return (
    r.jsonrpc === "2.0" &&
    typeof r.method === "string" &&
    (r.params === undefined || Array.isArray(r.params))
  );
}

export function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}

export function successResponse(
  id: string | number | null,
  result: unknown
): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result: result === undefined ? null : result };
}

export function extractError(err: unknown): {
  code: number;
  message: string;
  data?: unknown;
} {
  const code =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as any).code === "number" // narrowing unknown in type guard
      ? (err as any).code // narrowing unknown in type guard
      : -32000;
  const message =
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as any).message === "string" // narrowing unknown in type guard
      ? (err as any).message // narrowing unknown in type guard
      : "";
  const data =
    typeof err === "object" && err !== null && "data" in err
      ? (err as any).data // narrowing unknown in type guard
      : undefined;
  return { code, message, data };
}

/**
 * Process a single JSON-RPC request object. Returns a response or null for notifications.
 */
export async function processSingleRequest(
  body: unknown,
  service: any, // any: dynamic dispatch with arbitrary method signatures
  options?: RpcHandlerOptions
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(body)) {
    return errorResponse(null, -32600, "Invalid Request");
  }

  const isNotification = !("id" in body);

  // Notifications are not supported — ignore without executing
  if (isNotification) {
    options?.onError?.(
      new Error(`Received JSON-RPC notification for method "${body.method}" — notifications are not supported`)
    );
    return null;
  }

  const id = body.id ?? null;
  const { method, params } = body;

  // Reject rpc.-prefixed methods (spec-reserved)
  if (method.startsWith("rpc.")) {
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject Object.prototype methods (security)
  if (method in Object.prototype) {
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject non-function service properties
  if (typeof service[method] !== "function") {
    return errorResponse(id, -32601, "Method not found");
  }

  try {
    const result = await service[method](...(params ?? []));
    return successResponse(id, result);
  } catch (err) {
    options?.onError?.(err);
    const { code, message, data } = extractError(err);
    return errorResponse(id, code, message, data);
  }
}

/**
 * Transport-agnostic JSON-RPC 2.0 processor.
 * Takes parsed JSON body and a service object, returns response(s) or null.
 */
export async function processRpc<T>(
  body: unknown,
  service: T,
  options?: RpcHandlerOptions
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  // Primitives (not object, not array)
  if (typeof body !== "object" || body === null) {
    return errorResponse(null, -32600, "Invalid Request");
  }

  // Array → batch
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return errorResponse(null, -32600, "Invalid Request");
    }

    const results = await Promise.all(
      body.map((item) => processSingleRequest(item, service, options))
    );

    // Filter out nulls (notifications produce no response)
    const responses = results.filter(
      (r): r is JsonRpcResponse => r !== null
    );

    if (responses.length === 0) return null;
    return responses;
  }

  // Single request
  return processSingleRequest(body, service, options);
}
