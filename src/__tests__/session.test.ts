import { describe, it, expect, vi } from "vitest";
import { RpcSession, RpcError, RpcProtocolError } from "../session.js";
import type { RpcTransport } from "../session.js";

function createLinkedTransports(): [RpcTransport, RpcTransport] {
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

describe("Initiator calls method on acceptor", () => {
  type AcceptorService = {
    add(a: number, b: number): Promise<number>;
  };

  it("initiator calls method and gets result", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Acceptor service (on side B)
    const acceptorService: AcceptorService = {
      add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      },
    };

    // Create sessions
    const sessionA = new RpcSession<AcceptorService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, AcceptorService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Initiator calls remote method
    const result = await sessionA.remote.add(2, 3);

    expect(result).toBe(5);

    sessionA.close();
    sessionB.close();
  });

  it("initiator receives correct result from acceptor", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type AcceptorGreetService = {
      greet(name: string): Promise<string>;
    };

    const acceptorService: AcceptorGreetService = {
      greet(name: string): Promise<string> {
        return Promise.resolve(`Hello, ${name}!`);
      },
    };

    const sessionA = new RpcSession<AcceptorGreetService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, AcceptorGreetService>(transportB, acceptorService, {
      role: "acceptor",
    });

    const result = await sessionA.remote.greet("Alice");

    expect(result).toBe("Hello, Alice!");

    sessionA.close();
    sessionB.close();
  });
});

describe("Acceptor calls method on initiator", () => {
  type InitiatorService = {
    multiply(a: number, b: number): Promise<number>;
  };

  it("acceptor calls method and gets result", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Initiator service (on side A)
    const initiatorService: InitiatorService = {
      multiply(a: number, b: number): Promise<number> {
        return Promise.resolve(a * b);
      },
    };

    const sessionA = new RpcSession<Record<string, never>, InitiatorService>(transportA, initiatorService, {
      role: "initiator",
    });
    const sessionB = new RpcSession<InitiatorService, Record<string, never>>(transportB, {}, { role: "acceptor" });

    // Acceptor calls remote method
    const result = await sessionB.remote.multiply(3, 4);

    expect(result).toBe(12);

    sessionA.close();
    sessionB.close();
  });

  it("acceptor receives correct result from initiator", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type InitiatorUpperCaseService = {
      toUpperCase(text: string): Promise<string>;
    };

    const initiatorService: InitiatorUpperCaseService = {
      toUpperCase(text: string): Promise<string> {
        return Promise.resolve(text.toUpperCase());
      },
    };

    const sessionA = new RpcSession<Record<string, never>, InitiatorUpperCaseService>(transportA, initiatorService, {
      role: "initiator",
    });
    const sessionB = new RpcSession<InitiatorUpperCaseService, Record<string, never>>(transportB, {}, { role: "acceptor" });

    const result = await sessionB.remote.toUpperCase("hello");

    expect(result).toBe("HELLO");

    sessionA.close();
    sessionB.close();
  });
});

describe("Simultaneous calls without ID collision", () => {
  type CommonService = {
    add(a: number, b: number): Promise<number>;
    multiply(a: number, b: number): Promise<number>;
  };

  it("initiator uses positive IDs, acceptor uses negative IDs", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Spy on both transports to capture actual wire messages
    const sendSpyA = vi.spyOn(transportA, "send");
    const sendSpyB = vi.spyOn(transportB, "send");

    // Common service with methods both sides can call
    const service: CommonService = {
      add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      },
      multiply(a: number, b: number): Promise<number> {
        return Promise.resolve(a * b);
      },
    };

    const sessionA = new RpcSession<CommonService, CommonService>(transportA, service, { role: "initiator" });
    const sessionB = new RpcSession<CommonService, CommonService>(transportB, service, { role: "acceptor" });

    // Initiator calls: should generate wire-level IDs 1, 2, 3...
    const initiatorCalls = [
      sessionA.remote.add(1, 2),
      sessionA.remote.add(3, 4),
      sessionA.remote.add(5, 6),
    ];

    // Acceptor calls: should generate wire-level IDs -1, -2, -3...
    const acceptorCalls = [
      sessionB.remote.multiply(2, 3),
      sessionB.remote.multiply(4, 5),
      sessionB.remote.multiply(6, 7),
    ];

    await Promise.all([...initiatorCalls, ...acceptorCalls]);

    // Extract wire-level IDs from captured messages
    const initiatorRequestIds: number[] = [];
    const acceptorRequestIds: number[] = [];

    // Filter sendSpyA for requests (messages with "method" field)
    for (const call of sendSpyA.mock.calls) {
      const message = call[0];
      const parsed = JSON.parse(message);
      if (parsed.method) {
        initiatorRequestIds.push(parsed.id);
      }
    }

    // Filter sendSpyB for requests (messages with "method" field)
    for (const call of sendSpyB.mock.calls) {
      const message = call[0];
      const parsed = JSON.parse(message);
      if (parsed.method) {
        acceptorRequestIds.push(parsed.id);
      }
    }

    // Verify initiator IDs are all positive
    expect(initiatorRequestIds.every((id) => id > 0)).toBe(true);
    // Verify acceptor IDs are all negative
    expect(acceptorRequestIds.every((id) => id < 0)).toBe(true);
    // Verify no duplicates within initiator set
    expect(new Set(initiatorRequestIds).size).toBe(initiatorRequestIds.length);
    // Verify no duplicates within acceptor set
    expect(new Set(acceptorRequestIds).size).toBe(acceptorRequestIds.length);
    // Verify no collisions between both sets
    const allIds = [...initiatorRequestIds, ...acceptorRequestIds];
    expect(new Set(allIds).size).toBe(allIds.length);

    sessionA.close();
    sessionB.close();
  });

  it("no ID collisions when both sides call simultaneously", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Spy on both transports to capture actual wire messages
    const sendSpyA = vi.spyOn(transportA, "send");
    const sendSpyB = vi.spyOn(transportB, "send");

    type EchoService = {
      echo(value: number): Promise<number>;
    };

    const service: EchoService = {
      echo(value: number): Promise<number> {
        return Promise.resolve(value);
      },
    };

    const sessionA = new RpcSession<EchoService, EchoService>(transportA, service, { role: "initiator" });
    const sessionB = new RpcSession<EchoService, EchoService>(transportB, service, { role: "acceptor" });

    // Both sides make 5 calls each
    const calls = [];
    for (let i = 0; i < 5; i++) {
      calls.push(sessionA.remote.echo(1000 + i));
      calls.push(sessionB.remote.echo(2000 + i));
    }

    await Promise.all(calls);

    // Extract wire-level IDs from captured messages
    const wireIds: (number | string)[] = [];

    // Filter sendSpyA for requests (messages with "method" field)
    for (const call of sendSpyA.mock.calls) {
      const message = call[0];
      const parsed = JSON.parse(message);
      if (parsed.method) {
        wireIds.push(parsed.id);
      }
    }

    // Filter sendSpyB for requests (messages with "method" field)
    for (const call of sendSpyB.mock.calls) {
      const message = call[0];
      const parsed = JSON.parse(message);
      if (parsed.method) {
        wireIds.push(parsed.id);
      }
    }

    // All wire IDs should be unique (no collisions)
    expect(new Set(wireIds).size).toBe(wireIds.length);
    // Should have exactly 10 requests (5 from each side)
    expect(wireIds.length).toBe(10);
  });
});

describe("Void-returning methods", () => {
  type SideEffectService = {
    sideEffect(): Promise<void>;
  };

  it("void method resolves to null", async () => {
    const [transportA, transportB] = createLinkedTransports();

    let sideEffectRan = false;
    const acceptorService: SideEffectService = {
      sideEffect(): Promise<void> {
        sideEffectRan = true;
        return Promise.resolve();
      },
    };

    const sessionA = new RpcSession<SideEffectService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, SideEffectService>(transportB, acceptorService, {
      role: "acceptor",
    });

    const result = await sessionA.remote.sideEffect();

    expect(sideEffectRan).toBe(true);
    expect(result).toBe(null);

    sessionA.close();
    sessionB.close();
  });

  it("Promise<void> resolves even without explicit return", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type DoWorkService = {
      doWork(): Promise<void>;
    };

    const acceptorService: DoWorkService = {
      async doWork(): Promise<void> {
        // no explicit return
      },
    };

    const sessionA = new RpcSession<DoWorkService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, DoWorkService>(transportB, acceptorService, {
      role: "acceptor",
    });

    const result = await sessionA.remote.doWork();

    expect(result).toBe(null);

    sessionA.close();
    sessionB.close();
  });
});

describe("Remote method that throws", () => {
  type ThrowService = {
    throwWithData(): Promise<never>;
  };

  it("thrown error returns RpcError with code, message, data", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService: ThrowService = {
      throwWithData(): Promise<never> {
        const err = new Error("Something went wrong");
        (err as any).code = -32000;
        (err as any).data = { details: "extra info" };
        throw err;
      },
    };

    const sessionA = new RpcSession<ThrowService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, ThrowService>(transportB, acceptorService, {
      role: "acceptor",
    });

    try {
      await sessionA.remote.throwWithData();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).message).toBe("Something went wrong");
      expect((err as RpcError).code).toBe(-32000);
      expect((err as RpcError).data).toEqual({ details: "extra info" });
    }

    sessionA.close();
    sessionB.close();
  });

  it("thrown error with default code returns -32000", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type ThrowSimpleService = {
      throwSimple(): Promise<never>;
    };

    const acceptorService: ThrowSimpleService = {
      throwSimple(): Promise<never> {
        throw new Error("Something broke");
      },
    };

    const sessionA = new RpcSession<ThrowSimpleService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, ThrowSimpleService>(transportB, acceptorService, {
      role: "acceptor",
    });

    try {
      await sessionA.remote.throwSimple();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32000);
    }

    sessionA.close();
    sessionB.close();
  });

  it("thrown error without code property uses -32000", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type ThrowNoCodeService = {
      throwNoCode(): Promise<never>;
    };

    const acceptorService: ThrowNoCodeService = {
      throwNoCode(): Promise<never> {
        throw new Error("Basic error");
      },
    };

    const sessionA = new RpcSession<ThrowNoCodeService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, ThrowNoCodeService>(transportB, acceptorService, {
      role: "acceptor",
    });

    try {
      await sessionA.remote.throwNoCode();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32000);
    }

    sessionA.close();
    sessionB.close();
  });
});

describe("Method not found", () => {
  it("calling non-existent method rejects with -32601", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type AcceptorExistingService = {
      existingMethod(): Promise<string>;
    };

    const acceptorService: AcceptorExistingService = {
      existingMethod(): Promise<string> {
        return Promise.resolve("exists");
      },
    };

    type ClientExpectedService = {
      nonExistentMethod(): void;
    };

    const sessionA = new RpcSession<ClientExpectedService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, AcceptorExistingService>(transportB, acceptorService, {
      role: "acceptor",
    });

    try {
      await sessionA.remote.nonExistentMethod();
      expect.fail("Should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32601);
      expect((err as RpcError).message).toBe("Method not found");
    }

    sessionA.close();
    sessionB.close();
  });

  it("calling method on side without service rejects with -32601", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type AnyMethodService = {
      anyMethod(): void;
    };

    // Acceptor has empty service
    const sessionA = new RpcSession<AnyMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, Record<string, never>>(transportB, {}, { role: "acceptor" });

    try {
      await sessionA.remote.anyMethod();
      expect.fail("Should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32601);
    }

    sessionA.close();
    sessionB.close();
  });
});

describe("Messages sent individually", () => {
  type GetValueService = {
    getValue(): Promise<number>;
  };

  it("each call sends exactly one message", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const sendSpy = vi.spyOn(transportB, "send");

    const acceptorService: GetValueService = {
      getValue(): Promise<number> {
        return Promise.resolve(42);
      },
    };

    const sessionA = new RpcSession<GetValueService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, GetValueService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Clear the spy to start fresh
    sendSpy.mockClear();

    await sessionA.remote.getValue();

    // Should be exactly 1 message (the response)
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sessionA.close();
    sessionB.close();
  });

  it("multiple calls send multiple messages immediately", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const sendSpy = vi.spyOn(transportA, "send");

    type EchoService = {
      echo(value: number): Promise<number>;
    };

    const initiatorService = {};
    const acceptorService: EchoService = {
      echo(value: number): Promise<number> {
        return Promise.resolve(value);
      },
    };

    const sessionA = new RpcSession<EchoService, Record<string, never>>(transportA, initiatorService, {
      role: "initiator",
    });
    const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Clear the spy to start fresh
    sendSpy.mockClear();

    // Make 3 calls without awaiting yet
    const call1 = sessionA.remote.echo(1);
    const call2 = sessionA.remote.echo(2);
    const call3 = sessionA.remote.echo(3);

    // Each call should have sent a message immediately (3 total)
    // Note: we check after all three are initiated but before any complete
    expect(sendSpy).toHaveBeenCalledTimes(3);

    // Wait for completion
    await Promise.all([call1, call2, call3]);

    sessionA.close();
    sessionB.close();
  });
});

describe("session lifecycle", () => {
  type SlowMethodService = {
    slowMethod(): Promise<string>;
  };

  it("when transport closes, pending outgoing calls reject with close reason", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService: SlowMethodService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves - keeps call pending
        });
      },
    };

    const sessionA = new RpcSession<SlowMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, SlowMethodService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Start a call that will remain pending
    const callPromise = sessionA.remote.slowMethod();

    // Give transport a moment to send the message
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Close transport from the acceptor side
    transportB.close();

    // The pending call should reject with the close reason
    try {
      await callPromise;
      expect.fail("Call should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("Connection closed");
    }

    sessionA.close();
    sessionB.close();
  });

  it("session.close() rejects pending calls and calls transport.close()", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService: SlowMethodService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves - keeps call pending
        });
      },
    };

    const sessionA = new RpcSession<SlowMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, SlowMethodService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Spy on transport.close()
    const transportCloseSpy = vi.spyOn(transportA, "close");

    // Start a call that will remain pending
    const callPromise = sessionA.remote.slowMethod();

    // Give transport a moment to send the message
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Close session
    sessionA.close();

    // Pending call should reject
    try {
      await callPromise;
      expect.fail("Call should have rejected");
    } catch (err) {
      expect((err as Error).message).toBe("Session closed");
    }

    // transport.close() should have been called
    expect(transportCloseSpy).toHaveBeenCalled();

    sessionB.close();
  });

  it("calling session.remote.method() after close rejects immediately", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type SomeMethodService = {
      someMethod(): void;
    };

    const sessionA = new RpcSession<SomeMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, Record<string, never>>(transportB, {}, { role: "acceptor" });

    // Close the session
    sessionA.close();

    // Try to call a method after close
    try {
      await sessionA.remote.someMethod();
      expect.fail("Call should have rejected immediately");
    } catch (err) {
      expect((err as Error).message).toBe("Session is closed");
    }

    sessionB.close();
  });

  it("transport close during async service method execution doesn't crash", async () => {
    const [transportA, transportB] = createLinkedTransports();

    let methodStarted = false;
    let methodCompleted = false;

    type SlowAsyncMethodService = {
      slowAsyncMethod(): Promise<string>;
    };

    const acceptorService: SlowAsyncMethodService = {
      slowAsyncMethod(): Promise<string> {
        return new Promise((resolve) => {
          methodStarted = true;
          // Simulate slow async operation
          setTimeout(() => {
            methodCompleted = true;
            resolve("done");
          }, 100);
        });
      },
    };

    let onErrorCalled = false;
    let errorLogged: Error | null = null;

    const sessionA = new RpcSession<SlowAsyncMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, SlowAsyncMethodService>(transportB, acceptorService, {
      role: "acceptor",
      onError(err) {
        onErrorCalled = true;
        errorLogged = err as Error;
      },
    });

    // Start the call
    const callPromise = sessionA.remote.slowAsyncMethod();

    // Wait for method to start
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(methodStarted).toBe(true);

    // Close transport while method is still executing
    transportB.close();

    // The original call should reject because transport is closed
    try {
      await callPromise;
      expect.fail("Call should have rejected");
    } catch (err) {
      expect((err as Error).message).toContain("Connection closed");
    }

    // Wait a bit more for method to complete and attempt send
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify method completed
    expect(methodCompleted).toBe(true);

    // Verify error was logged via onError (send failed because transport is closed)
    expect(onErrorCalled).toBe(true);
    expect(errorLogged).toBeInstanceOf(RpcProtocolError);
    expect((errorLogged as RpcProtocolError).code).toBe("SEND_FAILED");
    expect((errorLogged as RpcProtocolError).cause).toBeInstanceOf(Error);

    sessionA.close();
    sessionB.close();
  });

  // Additional test: Multiple pending calls all reject when transport closes
  it("multiple pending calls all reject when transport closes", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService: SlowMethodService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves
        });
      },
    };

    const sessionA = new RpcSession<SlowMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, SlowMethodService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Start multiple pending calls
    const call1 = sessionA.remote.slowMethod();
    const call2 = sessionA.remote.slowMethod();
    const call3 = sessionA.remote.slowMethod();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Close transport
    transportB.close();

    // All pending calls should reject
    const results = await Promise.allSettled([call1, call2, call3]);

    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect((result.reason as Error).message).toContain("Connection closed");
      }
    });

    sessionA.close();
    sessionB.close();
  });

  // Additional test: Calling close multiple times is safe
  it("calling session.close() multiple times is safe", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type AnyMethodService = {
      anyMethod(): void;
    };

    const sessionA = new RpcSession<AnyMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, Record<string, never>>(transportB, {}, { role: "acceptor" });

    // Close multiple times - should not throw
    sessionA.close();
    sessionA.close();
    sessionA.close();

    // Subsequent calls should still reject
    try {
      await sessionA.remote.anyMethod();
      expect.fail("Should have rejected");
    } catch (err) {
      expect((err as Error).message).toBe("Session is closed");
    }

    sessionB.close();
  });
});

// --- Additional edge cases ---

describe("Session behavior", () => {
  it("session.close() prevents further calls", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type AnyMethodService = {
      anyMethod(): void;
    };

    const sessionA = new RpcSession<AnyMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, Record<string, never>>(transportB, {}, { role: "acceptor" });

    sessionA.close();

    try {
      await sessionA.remote.anyMethod();
      expect.fail("Should have rejected");
    } catch (err) {
      expect((err as Error).message).toBe("Session is closed");
    }

    sessionB.close();
  });

  it("close on either side closes both transports", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // transportB.onClose is already called by sessionB initialization, so we need to track
    // what happens when we close sessionA (which closes transportA)
    const transportACloseSpy = vi.spyOn(transportA, "close");

    const sessionA = new RpcSession<Record<string, never>, Record<string, never>>(transportA, {}, { role: "initiator" });
    const sessionB = new RpcSession<Record<string, never>, Record<string, never>>(transportB, {}, { role: "acceptor" });

    sessionA.close();

    // sessionA.close() should have called transportA.close()
    expect(transportACloseSpy).toHaveBeenCalled();

    sessionB.close();
  });

  it("rejects pending calls when transport closes", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type SlowMethodService = {
      slowMethod(): Promise<string>;
    };

    const acceptorService: SlowMethodService = {
      slowMethod(): Promise<string> {
        return new Promise((resolve) => {
          setTimeout(() => resolve("done"), 1000);
        });
      },
    };

    const sessionA = new RpcSession<SlowMethodService, Record<string, never>>(transportA, {}, { role: "initiator" });
    const _sessionB = new RpcSession<Record<string, never>, SlowMethodService>(transportB, acceptorService, {
      role: "acceptor",
    });

    const callPromise = sessionA.remote.slowMethod();

    // Close transport immediately
    transportA.close();

    try {
      await callPromise;
      expect.fail("Should have rejected");
    } catch (err) {
      expect((err as Error).message).toContain("Connection closed");
    }
  });
});

// --- Error resilience tests (AC4.1-AC4.5) ---

describe("session error resilience", () => {
  describe("Malformed JSON", () => {
    it("malformed JSON is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(value: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService: EchoService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
        role: "acceptor",
      });

      // Inject malformed JSON
      const malformedJSON = "not json{";
      transportB.send(malformedJSON);

      // Wait for error to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify error was logged
      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("PARSE_ERROR");
      expect((errors[0] as RpcProtocolError).cause).toBeInstanceOf(SyntaxError);

      // Verify session still works - make a successful call
      const result = await sessionA.remote.echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Unknown response ID", () => {
    it("response with unknown ID is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(value: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService: EchoService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
        role: "acceptor",
      });

      // Inject a response with unknown ID
      const unknownResponseJSON = JSON.stringify({
        jsonrpc: "2.0",
        id: 99999,
        result: "ghost",
      });
      transportB.send(unknownResponseJSON);

      // Wait for error to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify error was logged
      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("UNKNOWN_RESPONSE_ID");
      expect((errors[0] as Error).message).toContain("unknown ID");

      // Verify session still works - make a successful call
      const result = await sessionA.remote.echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Unroutable message", () => {
    it("message that is neither request nor response is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(value: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService: EchoService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
        role: "acceptor",
      });

      // Inject a message that is neither request nor response
      const unroutableJSON = JSON.stringify({
        jsonrpc: "2.0",
        data: "something",
      });
      transportB.send(unroutableJSON);

      // Wait for error to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify error was logged
      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("UNROUTABLE_MESSAGE");

      // Verify session still works - make a successful call
      const result = await sessionA.remote.echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Send failure", () => {
    it("transport.send() throwing rejects only that specific call, not the whole session", async () => {
      // Create a custom transport that fails on the first call only
      let sendCount = 0;
      let messageHandlerA: ((message: string) => void) | null = null;
      let closeHandlerA: ((reason?: Error) => void) | null = null;

      const transportA: RpcTransport = {
        send(message: string) {
          sendCount++;
          if (sendCount === 1) {
            // First call fails
            throw new Error("Send failed on first call");
          }
          messageHandlerB?.(message);
        },
        onMessage(handler) {
          messageHandlerA = handler;
        },
        onClose(handler) {
          closeHandlerA = handler;
        },
        close() {
          closeHandlerA?.();
        },
      };

      let messageHandlerB: ((message: string) => void) | null = null;
      let closeHandlerB: ((reason?: Error) => void) | null = null;

      const transportB: RpcTransport = {
        send(message: string) {
          messageHandlerA?.(message);
        },
        onMessage(handler) {
          messageHandlerB = handler;
        },
        onClose(handler) {
          closeHandlerB = handler;
        },
        close() {
          closeHandlerB?.();
        },
      };

      type EchoService = {
        echo(value: string): Promise<string>;
      };

      const acceptorService: EchoService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionA = new RpcSession<EchoService, Record<string, never>>(transportA, {}, { role: "initiator" });
      const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
        role: "acceptor",
      });

      // First call should fail because send() throws
      try {
        await sessionA.remote.echo("first");
        expect.fail("First call should have rejected");
      } catch (err) {
        expect((err as Error).message).toBe("Send failed on first call");
      }

      // Second call should succeed because send() no longer throws
      const result = await sessionA.remote.echo("second");
      expect(result).toBe("second");

      // Session is still alive
      const result2 = await sessionA.remote.echo("third");
      expect(result2).toBe("third");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Incoming notification", () => {
    it("incoming notification is not executed and is logged via onError", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      let handlerWasCalled = false;

      type TestMethodService = {
        testMethod(): Promise<void>;
      };

      const initiatorService: TestMethodService = {
        testMethod(): Promise<void> {
          handlerWasCalled = true;
          return Promise.resolve();
        },
      };

      const sessionA = new RpcSession<Record<string, never>, TestMethodService>(transportA, initiatorService, {
        role: "initiator",
        onError(err) {
          errors.push(err);
        },
      });

      const sessionB = new RpcSession<TestMethodService, Record<string, never>>(
        transportB,
        {},
        {
          role: "acceptor",
          onError(err) {
            errors.push(err);
          },
        },
      );

      // Inject a notification (request without id) into session A
      const notificationJSON = JSON.stringify({
        jsonrpc: "2.0",
        method: "testMethod",
      });
      transportB.send(notificationJSON);

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify handler was NOT called
      expect(handlerWasCalled).toBe(false);

      // Verify error was logged (from initiator's onError)
      const initiatorErrors = errors;
      expect(initiatorErrors.length).toBeGreaterThan(0);
      const notifError = initiatorErrors.find(
        (err) => err instanceof RpcProtocolError && err.code === "NOTIFICATION_RECEIVED",
      );
      expect(notifError).toBeDefined();
      expect((notifError as RpcProtocolError).message).toContain("notification");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Non-object message", () => {
    it("non-object JSON is logged via onError with INVALID_MESSAGE code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(v: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = new RpcSession<Record<string, never>, EchoService>(
        transportB,
        { echo: (v: string) => Promise.resolve(v) },
        { role: "acceptor" },
      );

      // Inject a non-object JSON value (a plain string)
      transportB.send(JSON.stringify("just a string"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("INVALID_MESSAGE");

      // Session still works
      const result = await sessionA.remote.echo("ok");
      expect(result).toBe("ok");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Invalid response", () => {
    it("response that fails type guard is logged with INVALID_RESPONSE code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(v: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = new RpcSession<Record<string, never>, EchoService>(
        transportB,
        { echo: (v: string) => Promise.resolve(v) },
        { role: "acceptor" },
      );

      // Inject a response-like object that fails the type guard (missing jsonrpc version)
      transportB.send(
        JSON.stringify({
          id: 1,
          result: "bad",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("INVALID_RESPONSE");

      sessionA.close();
      sessionB.close();
    });
  });

  describe("Null response ID", () => {
    it("response with null ID is logged with NULL_RESPONSE_ID code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      type EchoService = {
        echo(v: string): Promise<string>;
      };

      const errors: unknown[] = [];
      const sessionA = new RpcSession<EchoService, Record<string, never>>(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = new RpcSession<Record<string, never>, EchoService>(
        transportB,
        { echo: (v: string) => Promise.resolve(v) },
        { role: "acceptor" },
      );

      // Inject a response with null ID
      transportB.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          result: "orphan",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errors.length).toBe(1);
      expect(errors[0]).toBeInstanceOf(RpcProtocolError);
      expect((errors[0] as RpcProtocolError).code).toBe("NULL_RESPONSE_ID");

      sessionA.close();
      sessionB.close();
    });
  });

  // Additional comprehensive test: Multiple errors don't crash session
  it("multiple errors in sequence don't crash session", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type EchoService = {
      echo(value: string): Promise<string>;
    };

    const errorLog: unknown[] = [];
    const sessionA = new RpcSession<EchoService, Record<string, never>>(
      transportA,
      {},
      {
        role: "initiator",
        onError(err) {
          errorLog.push(err);
        },
      },
    );

    const acceptorService: EchoService = {
      echo(value: string): Promise<string> {
        return Promise.resolve(value);
      },
    };

    const sessionB = new RpcSession<Record<string, never>, EchoService>(transportB, acceptorService, {
      role: "acceptor",
    });

    // Inject multiple errors
    // 1. Malformed JSON
    transportB.send("not json{");

    // 2. Unknown response ID
    transportB.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 88888,
        result: "unknown",
      }),
    );

    // 3. Unroutable message
    transportB.send(
      JSON.stringify({
        jsonrpc: "2.0",
        bogus: "field",
      }),
    );

    // 4. Notification
    transportB.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "echo",
      }),
    );

    // Wait for all errors to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify errors were logged with correct codes
    expect(errorLog.length).toBe(4);
    const codes = errorLog.map((e) => (e as RpcProtocolError).code);
    expect(codes).toContain("PARSE_ERROR");
    expect(codes).toContain("UNKNOWN_RESPONSE_ID");
    expect(codes).toContain("UNROUTABLE_MESSAGE");
    expect(codes).toContain("NOTIFICATION_RECEIVED");

    // Verify session still works - make multiple successful calls
    const result1 = await sessionA.remote.echo("recovery1");
    const result2 = await sessionA.remote.echo("recovery2");
    const result3 = await sessionA.remote.echo("recovery3");

    expect(result1).toBe("recovery1");
    expect(result2).toBe("recovery2");
    expect(result3).toBe("recovery3");

    sessionA.close();
    sessionB.close();
  });
});

describe("Bidirectional RPC", () => {
  type MathService = {
    add(a: number, b: number): number;
    multiply(a: number, b: number): number;
  };

  type GreetingService = {
    greet(name: string): string;
    getLocale(): string;
  };

  it("both sides call each other's methods", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const mathService: MathService = {
      add: (a, b) => a + b,
      multiply: (a, b) => a * b,
    };

    const greetingService: GreetingService = {
      greet: (name) => `Hello, ${name}!`,
      getLocale: () => "en-US",
    };

    const sessionA = new RpcSession<GreetingService, MathService>(
      transportA,
      mathService,
      { role: "initiator" },
    );
    const sessionB = new RpcSession<MathService, GreetingService>(
      transportB,
      greetingService,
      { role: "acceptor" },
    );

    // A calls B's greeting service
    expect(await sessionA.remote.greet("world")).toBe("Hello, world!");
    expect(await sessionA.remote.getLocale()).toBe("en-US");

    // B calls A's math service
    expect(await sessionB.remote.add(3, 4)).toBe(7);
    expect(await sessionB.remote.multiply(5, 6)).toBe(30);

    sessionA.close();
  });

  it("both sides call each other concurrently", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const mathService: MathService = {
      add: (a, b) => a + b,
      multiply: (a, b) => a * b,
    };

    const greetingService: GreetingService = {
      greet: (name) => `Hello, ${name}!`,
      getLocale: () => "en-US",
    };

    const sessionA = new RpcSession<GreetingService, MathService>(
      transportA,
      mathService,
      { role: "initiator" },
    );
    const sessionB = new RpcSession<MathService, GreetingService>(
      transportB,
      greetingService,
      { role: "acceptor" },
    );

    // Both sides fire calls at the same time
    const [greeting, locale, sum, product] = await Promise.all([
      sessionA.remote.greet("world"),
      sessionA.remote.getLocale(),
      sessionB.remote.add(10, 20),
      sessionB.remote.multiply(3, 7),
    ]);

    expect(greeting).toBe("Hello, world!");
    expect(locale).toBe("en-US");
    expect(sum).toBe(30);
    expect(product).toBe(21);

    sessionA.close();
  });

  it("server method calls back to client during handling", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type ClientService = {
      getMultiplier(): number;
    };

    type ServerService = {
      computeWithClientMultiplier(a: number, b: number): Promise<number>;
    };

    const clientService: ClientService = {
      getMultiplier: () => 10,
    };

    const sessionA = new RpcSession<ServerService, ClientService>(
      transportA,
      clientService,
      { role: "initiator" },
    );

    // Server service calls back to the client to get the multiplier
    const serverService: ServerService = {
      computeWithClientMultiplier: async (a, b) => {
        const multiplier = await sessionB.remote.getMultiplier();
        return (a + b) * multiplier;
      },
    };

    const sessionB = new RpcSession<ClientService, ServerService>(
      transportB,
      serverService,
      { role: "acceptor" },
    );

    const result = await sessionA.remote.computeWithClientMultiplier(3, 4);
    expect(result).toBe(70); // (3 + 4) * 10

    sessionA.close();
  });

  it("errors propagate correctly in both directions", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type ServiceA = {
      failA(): never;
    };

    type ServiceB = {
      failB(): never;
    };

    const serviceA: ServiceA = {
      failA() {
        const err = new Error("Error from A");
        (err as any).code = -32001;
        throw err;
      },
    };

    const serviceB: ServiceB = {
      failB() {
        const err = new Error("Error from B");
        (err as any).code = -32002;
        throw err;
      },
    };

    const sessionA = new RpcSession<ServiceB, ServiceA>(
      transportA,
      serviceA,
      { role: "initiator" },
    );
    const sessionB = new RpcSession<ServiceA, ServiceB>(
      transportB,
      serviceB,
      { role: "acceptor" },
    );

    // A calls B, gets B's error
    await expect(sessionA.remote.failB()).rejects.toThrow(RpcError);
    try {
      await sessionA.remote.failB();
    } catch (err) {
      expect((err as RpcError).code).toBe(-32002);
      expect((err as RpcError).message).toBe("Error from B");
    }

    // B calls A, gets A's error
    await expect(sessionB.remote.failA()).rejects.toThrow(RpcError);
    try {
      await sessionB.remote.failA();
    } catch (err) {
      expect((err as RpcError).code).toBe(-32001);
      expect((err as RpcError).message).toBe("Error from A");
    }

    sessionA.close();
  });

  it("close rejects pending calls on both sides", async () => {
    const [transportA, transportB] = createLinkedTransports();

    type SlowService = {
      slow(): Promise<string>;
    };

    // Services that never resolve
    const neverResolveA: SlowService = {
      slow: () => new Promise(() => {}),
    };
    const neverResolveB: SlowService = {
      slow: () => new Promise(() => {}),
    };

    const sessionA = new RpcSession<SlowService, SlowService>(
      transportA,
      neverResolveA,
      { role: "initiator" },
    );
    const sessionB = new RpcSession<SlowService, SlowService>(
      transportB,
      neverResolveB,
      { role: "acceptor" },
    );

    // Both sides have pending outgoing calls
    const pA = sessionA.remote.slow();
    const pB = sessionB.remote.slow();

    sessionA.close();

    await expect(pA).rejects.toThrow();
    await expect(pB).rejects.toThrow();
  });
});
