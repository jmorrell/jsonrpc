import { newHttpBatchRpcSession } from "@jmorrell/jsonrpc";
import type { Api } from "../../src/worker";
import "./style.css";

// ── Call a single method ──

async function callMethod(method: string) {
  const container = $(`${method}-result`);
  resetCapture();

  const api = newHttpBatchRpcSession<Api>("/api");
  const params = paramReaders[method]();
  const t0 = performance.now();

  try {
    const result = await (api as any)[method](...params);
    const ms = performance.now() - t0;
    renderExchange(container, lastRequest, lastResponse, ms, postCount);
  } catch (err) {
    const ms = performance.now() - t0;
    renderExchange(container, lastRequest, lastResponse, ms, postCount);
  }
}

// ── Auto-batching demo ──
// All these calls are made synchronously, so the library auto-batches
// them into a single HTTP POST with a JSON-RPC batch array.

async function runBatch() {
  const container = $("batch-result");
  resetCapture();
  const t0 = performance.now();

  const api = newHttpBatchRpcSession<Api>("/api");

  const [sum, product, greeting, time, echoed] = await Promise.all([
    api.add(10, 20),
    api.multiply(3, 14),
    api.greet("Batch"),
    api.now(),
    api.echo("hello", 42, true),
  ]);

  const ms = performance.now() - t0;

  renderExchange(container, lastRequest, lastResponse, ms, postCount);

  $("batch-values").innerHTML = `
    <pre>${JSON.stringify({ sum, product, greeting, time, echoed }, null, 2)}</pre>
  `;
  $("batch-values").style.display = "block";
}

// ── Plumbing (DOM helpers, fetch interceptor, param readers) ──

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function inputVal(id: string): string {
  return ($(id) as HTMLInputElement).value;
}

const paramReaders: Record<string, () => unknown[]> = {
  add: () => [Number(inputVal("add-a")), Number(inputVal("add-b"))],
  multiply: () => [Number(inputVal("multiply-a")), Number(inputVal("multiply-b"))],
  greet: () => [inputVal("greet-name")],
  now: () => [],
  echo: () => {
    try {
      return JSON.parse(inputVal("echo-args"));
    } catch {
      return ["(invalid JSON)"];
    }
  },
};

function renderExchange(
  container: HTMLElement,
  request: unknown,
  response: unknown,
  ms: number,
  posts: number,
) {
  const isError = typeof response === "object" && response !== null && "error" in response;
  container.innerHTML = `
    <div class="rpc-exchange">
      <div class="rpc-panel">
        <div class="rpc-panel-label request">Request &middot; ${posts} POST${posts === 1 ? "" : "s"}</div>
        <pre>${JSON.stringify(request, null, 2)}</pre>
      </div>
      <div class="rpc-panel">
        <div class="rpc-panel-label response${isError ? " error" : ""}">Response</div>
        <pre>${JSON.stringify(response, null, 2)}</pre>
      </div>
    </div>
    <div class="rpc-time">${ms.toFixed(1)} ms</div>
  `;
}

// Intercept fetch to count POSTs and capture raw JSON-RPC payloads for display
const origFetch = globalThis.fetch;
let postCount = 0;
let lastRequest: unknown = null;
let lastResponse: unknown = null;

function resetCapture() {
  postCount = 0;
  lastRequest = null;
  lastResponse = null;
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (method === "POST") {
    postCount++;
    if (init?.body) {
      try {
        lastRequest = JSON.parse(init.body as string);
      } catch {
        lastRequest = init.body;
      }
    }
    return origFetch(input, init).then(async (res) => {
      const clone = res.clone();
      try {
        lastResponse = await clone.json();
      } catch {
        lastResponse = null;
      }
      return res;
    });
  }
  return origFetch(input, init);
}) as typeof fetch;

// Expose to HTML onclick handlers
(window as any).callMethod = callMethod;
(window as any).runBatch = runBatch;
