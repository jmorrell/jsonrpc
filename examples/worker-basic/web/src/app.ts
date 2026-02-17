import { newHttpBatchRpcSession, newWebSocketRpcSession } from "@jmorrell/jsonrpc";
import type { Api } from "../../src/worker";
import "./style.css";

// ── Transport switching ──

type Transport = "http" | "websocket";
type ApiProxy = { [K in keyof Api]: (...args: Parameters<Api[K]>) => Promise<ReturnType<Api[K]>> };

let currentTransport: Transport = "http";
let wsApi: (ApiProxy & { close(): void }) | null = null;
let ws: WebSocket | null = null;

function getApi(): ApiProxy {
  if (currentTransport === "http") {
    // Fresh session each time so synchronous calls get auto-batched together
    return newHttpBatchRpcSession<Api>("/api");
  }
  return wsApi!;
}

function connectWebSocket() {
  const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api`;
  ws = instrumentWebSocket(new WebSocket(wsUrl));
  wsApi = newWebSocketRpcSession<Api>(ws);
}

function disconnectWebSocket() {
  if (wsApi) {
    wsApi.close();
    wsApi = null;
    ws = null;
  }
}

function switchTransport(t: Transport) {
  if (t === currentTransport) return;
  if (currentTransport === "websocket") disconnectWebSocket();
  currentTransport = t;
  if (t === "websocket") connectWebSocket();

  // Update toggle UI
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".toggle-btn")) {
    btn.classList.toggle("active", btn.dataset.transport === t);
  }
  // Update section visibility
  $("section-http").style.display = t === "http" ? "" : "none";
  $("section-ws").style.display = t === "websocket" ? "" : "none";
  // Update connection status visibility
  $("ws-status-row").style.display = t === "websocket" ? "" : "none";
  // Clear previous results
  for (const el of document.querySelectorAll<HTMLElement>(".result-area")) el.innerHTML = "";
}

// ── Call a single method ──

async function callMethod(method: string) {
  const container = $(`${method}-result`);
  resetCapture();

  const api = getApi();
  const params = paramReaders[method]();
  const t0 = performance.now();

  try {
    await (api as any)[method](...params);
    const ms = performance.now() - t0;
    renderExchange(container, lastSent(), lastReceived(), ms, httpPostCount);
  } catch {
    const ms = performance.now() - t0;
    renderExchange(container, lastSent(), lastReceived(), ms, httpPostCount);
  }
}

// ── HTTP auto-batching demo ──
// All calls made synchronously on the same session get batched into a
// single HTTP POST with a JSON-RPC batch array.

async function runBatch() {
  const container = $("batch-result");
  resetCapture();
  const t0 = performance.now();

  const api = getApi();

  const [sum, product, greeting, time, echoed] = await Promise.all([
    api.add(10, 20),
    api.multiply(3, 14),
    api.greet("Batch"),
    api.now(),
    api.echo("hello", 42, true),
  ]);

  const ms = performance.now() - t0;
  renderExchange(container, lastSent(), lastReceived(), ms, httpPostCount);

  $("batch-values").innerHTML = `
    <pre>${JSON.stringify({ sum, product, greeting, time, echoed }, null, 2)}</pre>
  `;
  $("batch-values").style.display = "block";
}

// ── WebSocket concurrent calls demo ──
// With WebSockets there's no HTTP overhead per call, so batching isn't
// necessary. Each call is an individual JSON-RPC message over the same
// persistent connection.

async function runMultiple() {
  const container = $("multi-result");
  resetCapture();
  const t0 = performance.now();

  const api = getApi();

  const [sum, product, greeting, time, echoed] = await Promise.all([
    api.add(10, 20),
    api.multiply(3, 14),
    api.greet("WebSocket"),
    api.now(),
    api.echo("hello", 42, true),
  ]);

  const ms = performance.now() - t0;
  renderExchange(container, wsSentAll.slice(), wsReceivedAll.slice(), ms, 0);

  $("multi-values").innerHTML = `
    <pre>${JSON.stringify({ sum, product, greeting, time, echoed }, null, 2)}</pre>
  `;
  $("multi-values").style.display = "block";
}

// ── Plumbing (DOM helpers, interceptors, param readers) ──

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
  const isHttp = currentTransport === "http";
  const sentLabel = isHttp ? `Request · ${posts} POST${posts === 1 ? "" : "s"}` : "Sent";
  const recvLabel = isHttp ? "Response" : "Received";
  container.innerHTML = `
    <div class="rpc-exchange">
      <div class="rpc-panel">
        <div class="rpc-panel-label request">${sentLabel}</div>
        <pre>${JSON.stringify(request, null, 2)}</pre>
      </div>
      <div class="rpc-panel">
        <div class="rpc-panel-label response${isError ? " error" : ""}">${recvLabel}</div>
        <pre>${JSON.stringify(response, null, 2)}</pre>
      </div>
    </div>
    <div class="rpc-time">${ms.toFixed(1)} ms</div>
  `;
}

// ── HTTP fetch interceptor ──

const origFetch = globalThis.fetch;
let httpPostCount = 0;
let httpLastRequest: unknown = null;
let httpLastResponse: unknown = null;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (method === "POST") {
    httpPostCount++;
    if (init?.body) {
      try {
        httpLastRequest = JSON.parse(init.body as string);
      } catch {
        httpLastRequest = init.body;
      }
    }
    return origFetch(input, init).then(async (res) => {
      const clone = res.clone();
      try {
        httpLastResponse = await clone.json();
      } catch {
        httpLastResponse = null;
      }
      return res;
    });
  }
  return origFetch(input, init);
}) as typeof fetch;

// ── WebSocket interceptor ──

let wsLastSent: unknown = null;
let wsLastReceived: unknown = null;
let wsSentAll: unknown[] = [];
let wsReceivedAll: unknown[] = [];

function instrumentWebSocket(socket: WebSocket): WebSocket {
  const origSend = socket.send.bind(socket);
  socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        wsLastSent = parsed;
        wsSentAll.push(parsed);
      } catch {
        wsLastSent = data;
        wsSentAll.push(data);
      }
    }
    origSend(data);
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const parsed = JSON.parse(event.data);
        wsLastReceived = parsed;
        wsReceivedAll.push(parsed);
      } catch {
        wsLastReceived = event.data;
        wsReceivedAll.push(event.data);
      }
    }
  });

  const statusEl = document.getElementById("ws-status");
  if (statusEl) {
    socket.addEventListener("open", () => {
      statusEl.textContent = "Connected";
      statusEl.className = "ws-status connected";
    });
    socket.addEventListener("close", () => {
      statusEl.textContent = "Disconnected";
      statusEl.className = "ws-status disconnected";
    });
    socket.addEventListener("error", () => {
      statusEl.textContent = "Error";
      statusEl.className = "ws-status disconnected";
    });
  }

  return socket;
}

// ── Capture helpers ──

function lastSent(): unknown {
  return currentTransport === "http" ? httpLastRequest : wsLastSent;
}

function lastReceived(): unknown {
  return currentTransport === "http" ? httpLastResponse : wsLastReceived;
}

function resetCapture() {
  httpPostCount = 0;
  httpLastRequest = null;
  httpLastResponse = null;
  wsLastSent = null;
  wsLastReceived = null;
  wsSentAll = [];
  wsReceivedAll = [];
}

// ── Expose to HTML onclick handlers ──

(window as any).callMethod = callMethod;
(window as any).runBatch = runBatch;
(window as any).runMultiple = runMultiple;
(window as any).switchTransport = switchTransport;
