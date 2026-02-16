import type { RpcTransport } from "../session.js";

export function createLinkedTransports(): [RpcTransport, RpcTransport] {
  let messageHandlerA: ((message: string) => void) | null = null;
  let messageHandlerB: ((message: string) => void) | null = null;
  let closeHandlerA: ((reason?: Error) => void) | null = null;
  let closeHandlerB: ((reason?: Error) => void) | null = null;
  let closed = false;

  const transportA: RpcTransport = {
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

  const transportB: RpcTransport = {
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
