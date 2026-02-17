import { newWebSocketRpcSession } from "@jmorrell/jsonrpc";
import type { ServerApi, ClientApi, AuditEvent } from "../../src/worker";
import "./style.css";

// ── Connect with bidirectional RPC ──
// The second type parameter + local service object tells the library
// that the server can call methods on us. Here the server pushes audit
// events via onEvent() whenever any client invokes a method.

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api`;

const localService: ClientApi = {
  onEvent(event: AuditEvent) {
    appendEvent(event);
  },
};

const session = newWebSocketRpcSession<ServerApi, ClientApi>(wsUrl, localService);

// ── Call a server method ──

async function callMethod(method: string) {
  const resultEl = $(`${method}-result`);
  const params = paramReaders[method]();

  try {
    const result = await (session.remote as any)[method](...params);
    resultEl.textContent = JSON.stringify(result);
    resultEl.className = "method-result";
  } catch (err) {
    resultEl.textContent = String(err);
    resultEl.className = "method-result error";
  }
}

// ── Plumbing ──

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

function formatArgs(args: unknown[]): string {
  return args.map((a) => JSON.stringify(a)).join(", ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function appendEvent(event: AuditEvent) {
  const log = $("event-log");
  const empty = log.querySelector(".log-empty");
  if (empty) empty.remove();

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `
    <span class="log-time">${formatTime(event.timestamp)}</span>
    <span class="log-call">${event.method}(${formatArgs(event.args)})</span>
    <span class="log-arrow">&rarr;</span>
    <span class="log-result">${JSON.stringify(event.result)}</span>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

(window as any).callMethod = callMethod;
