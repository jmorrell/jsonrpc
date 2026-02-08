import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  JsonRpcSuccessResponse,
  RpcHandlerOptions,
} from "./types.js";

export type { RpcHandlerOptions } from "./types.js";

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

function errorResponse(
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

function successResponse(
  id: string | number | null,
  result: unknown
): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result: result === undefined ? null : result };
}

function extractError(err: unknown): {
  code: number;
  message: string;
  data?: unknown;
} {
  const code =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as any).code === "number"
      ? (err as any).code
      : -32000;
  const message =
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as any).message === "string"
      ? (err as any).message
      : "";
  const data =
    typeof err === "object" && err !== null && "data" in err
      ? (err as any).data
      : undefined;
  return { code, message, data };
}

/**
 * Process a single JSON-RPC request object. Returns a response or null for notifications.
 */
async function processSingleRequest(
  body: unknown,
  service: any,
  options?: RpcHandlerOptions
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(body)) {
    return errorResponse(null, -32600, "Invalid Request");
  }

  const isNotification = !("id" in body);
  const id = isNotification ? null : (body.id ?? null);
  const { method, params } = body;

  // Reject rpc.-prefixed methods (spec-reserved)
  if (method.startsWith("rpc.")) {
    if (isNotification) return null;
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject Object.prototype methods (security)
  if (method in Object.prototype) {
    if (isNotification) return null;
    return errorResponse(id, -32601, "Method not found");
  }

  // Reject non-function service properties
  if (typeof service[method] !== "function") {
    if (isNotification) return null;
    return errorResponse(id, -32601, "Method not found");
  }

  try {
    const result = await service[method](...(params ?? []));
    if (isNotification) return null;
    return successResponse(id, result);
  } catch (err) {
    options?.onError?.(err);
    if (isNotification) return null;
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

/**
 * HTTP wrapper around processRpc. Takes a Request, returns a Response.
 */
export async function handleRpc<T>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions
): Promise<Response> {
  // Check HTTP method
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  // Parse JSON body
  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(
      JSON.stringify(errorResponse(null, -32700, "Parse error")),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Process
  const result = await processRpc(parsed, service, options);

  // Notification → 204
  if (result === null) {
    return new Response(null, { status: 204 });
  }

  // Return JSON response
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
