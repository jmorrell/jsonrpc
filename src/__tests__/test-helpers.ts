import type { RpcMessageTransport } from "../session.js";

/**
 * Mock WebSocket class for testing without real WebSocket API.
 */
export class MockWebSocket {
  readyState = WebSocket.OPEN;
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  private sentMsgs: Array<string> = [];

  constructor(initialReadyState: number = WebSocket.OPEN) {
    this.readyState = initialReadyState;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sentMsgs.push(data);
  }

  close(): void {
    for (const handler of this.listeners.get("close") ?? []) {
      handler(new CloseEvent("close"));
    }
  }

  /**
   * Test helper: simulate incoming message
   */
  _receiveMessage(data: string): void {
    for (const handler of this.listeners.get("message") ?? []) {
      handler(new MessageEvent("message", { data }));
    }
  }

  /**
   * Test helper: simulate opening (for queue flush tests)
   */
  _fireOpen(): void {
    for (const handler of this.listeners.get("open") ?? []) {
      handler(new Event("open"));
    }
  }

  /**
   * Test helper: simulate error
   */
  _fireError(): void {
    for (const handler of this.listeners.get("error") ?? []) {
      handler(new Event("error"));
    }
  }

  /**
   * Test helper: get all messages sent
   */
  _getSentMessages(): Array<string> {
    return this.sentMsgs;
  }

  /**
   * Test helper: clear sent messages
   */
  _clearSentMessages(): void {
    this.sentMsgs = [];
  }
}

/**
 * Mock WebSocket for use in WebSocketPair testing.
 * Used to simulate server-side WebSockets in dispatcher tests.
 */
export class MockWebSocketForPair {
  readyState = WebSocket.OPEN;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  accept(): void {
    // No-op for mock
  }

  send(_data: string): void {
    // No-op for mock
  }

  close(): void {
    for (const handler of this.listeners.get("close") ?? []) {
      handler(new CloseEvent("close"));
    }
  }
}

/**
 * Mock WebSocketPair for testing in non-Workers environments.
 * Simulates the Cloudflare Workers WebSocketPair API.
 */
export class MockWebSocketPair {
  public 0 = new MockWebSocketForPair();
  public 1 = new MockWebSocketForPair();

  [Symbol.iterator]() {
    return [this[0], this[1]][Symbol.iterator]();
  }
}

Object.defineProperty(MockWebSocketPair.prototype, Symbol.toStringTag, {
  value: "WebSocketPair",
});

export function createLinkedTransports(): [RpcMessageTransport, RpcMessageTransport] {
  let messageHandlerA: ((message: string) => void) | null = null;
  let messageHandlerB: ((message: string) => void) | null = null;
  let closeHandlerA: ((reason?: Error) => void) | null = null;
  let closeHandlerB: ((reason?: Error) => void) | null = null;
  let closed = false;

  const transportA: RpcMessageTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerB?.(message);
    },
    onMessage(handler) {
      messageHandlerA = handler;
    },
    onClose(handler) {
      closeHandlerA = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  const transportB: RpcMessageTransport = {
    send(message: string) {
      if (closed) throw new Error("Transport is closed");
      messageHandlerA?.(message);
    },
    onMessage(handler) {
      messageHandlerB = handler;
    },
    onClose(handler) {
      closeHandlerB = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      const reason = new Error("Connection closed");
      closeHandlerA?.(reason);
      closeHandlerB?.(reason);
    },
  };

  return [transportA, transportB];
}
