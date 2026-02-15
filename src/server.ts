import type { RpcHandlerOptions } from "./core.js";
import { errorResponse, processRpc } from "./core.js";

export type { RpcHandlerOptions, RpcProtocolErrorCode } from "./core.js";
export { RpcProtocolError, processRpc, isJsonRpcRequest } from "./core.js";

/**
 * HTTP wrapper around processRpc. Takes a Request, returns a Response.
 */
export async function handleRpc<T>(
  request: Request,
  service: T,
  options?: RpcHandlerOptions,
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
      },
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
