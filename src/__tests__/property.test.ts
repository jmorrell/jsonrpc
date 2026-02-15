import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { processRpc } from "../server.js";
import type { JsonRpcResponse, JsonRpcErrorResponse } from "../core.js";

// Service with methods that handle anything
const service = {
  echo(...args: any[]) {
    return args;
  },
  add(a: number, b: number) {
    return a + b;
  },
  noop() {},
};

function isValidResponse(res: unknown): res is JsonRpcResponse {
  if (typeof res !== "object" || res === null) return false;
  const r = res as any;
  if (r.jsonrpc !== "2.0") return false;
  if (!("id" in r)) return false;
  if ("result" in r && !("error" in r)) return true;
  if ("error" in r && !("result" in r)) {
    const e = r.error;
    return (
      typeof e === "object" &&
      e !== null &&
      typeof e.code === "number" &&
      typeof e.message === "string"
    );
  }
  return false;
}

describe("property-based tests", () => {
  it("any valid JsonRpcRequest produces a valid JsonRpcResponse", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jsonrpc: fc.constant("2.0" as const),
          id: fc.oneof(fc.integer(), fc.string(), fc.constant(null)),
          method: fc.constantFrom("echo", "add", "noop"),
          params: fc.array(fc.jsonValue(), { maxLength: 5 }),
        }),
        async (request) => {
          const result = await processRpc(request, service);
          expect(result).not.toBeNull();
          expect(isValidResponse(result)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("batch of N non-notification requests → exactly N responses", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            jsonrpc: fc.constant("2.0" as const),
            id: fc.oneof(fc.integer({ min: 1, max: 10000 }), fc.string()),
            method: fc.constantFrom("echo", "add", "noop"),
            params: fc.array(fc.jsonValue(), { maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (batch) => {
          const result = await processRpc(batch, service);
          expect(Array.isArray(result)).toBe(true);
          expect((result as any[]).length).toBe(batch.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("response IDs always match request IDs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            jsonrpc: fc.constant("2.0" as const),
            id: fc.integer({ min: 1, max: 10000 }),
            method: fc.constantFrom("echo", "add", "noop"),
            params: fc.array(fc.jsonValue(), { maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (batch) => {
          const result = await processRpc(batch, service);
          const responses = result as JsonRpcResponse[];
          const requestIds = new Set(batch.map((r) => r.id));
          for (const res of responses) {
            expect(requestIds.has(res.id as number)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("error responses always have valid error objects", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jsonrpc: fc.constant("2.0" as const),
          id: fc.oneof(fc.integer(), fc.string(), fc.constant(null)),
          method: fc.string(), // random method names — most won't exist
        }),
        async (request) => {
          const result = await processRpc(request, service);
          if (result && "error" in (result as any)) {
            const err = (result as JsonRpcErrorResponse).error;
            expect(typeof err.code).toBe("number");
            expect(typeof err.message).toBe("string");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
