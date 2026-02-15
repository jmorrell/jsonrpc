import { describe, it, expect, vi } from "vitest";
import { rpcSession, RpcError, RpcProtocolError } from "../session.js";
import { createLinkedTransports } from "./test-helpers.js";
import type { RpcMessageTransport } from "../types.js";

// --- AC2.1: Initiator calls method on acceptor's service ---

describe("AC2.1: Initiator calls method on acceptor", () => {
  it("initiator calls method and gets result", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Acceptor service (on side B)
    const acceptorService = {
      add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      },
    };

    // Create sessions
    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Initiator calls remote method
    const result = await (sessionA.remote as any).add(2, 3);

    expect(result).toBe(5);

    sessionA.close();
    sessionB.close();
  });

  it("initiator receives correct result from acceptor", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      greet(name: string): Promise<string> {
        return Promise.resolve(`Hello, ${name}!`);
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    const result = await (sessionA.remote as any).greet("Alice");

    expect(result).toBe("Hello, Alice!");

    sessionA.close();
    sessionB.close();
  });
});

// --- AC2.2: Acceptor calls method on initiator's service ---

describe("AC2.2: Acceptor calls method on initiator", () => {
  it("acceptor calls method and gets result", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Initiator service (on side A)
    const initiatorService = {
      multiply(a: number, b: number): Promise<number> {
        return Promise.resolve(a * b);
      },
    };

    const sessionA = rpcSession(transportA, initiatorService, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    // Acceptor calls remote method
    const result = await (sessionB.remote as any).multiply(3, 4);

    expect(result).toBe(12);

    sessionA.close();
    sessionB.close();
  });

  it("acceptor receives correct result from initiator", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const initiatorService = {
      toUpperCase(text: string): Promise<string> {
        return Promise.resolve(text.toUpperCase());
      },
    };

    const sessionA = rpcSession(transportA, initiatorService, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    const result = await (sessionB.remote as any).toUpperCase("hello");

    expect(result).toBe("HELLO");

    sessionA.close();
    sessionB.close();
  });
});

// --- AC2.3: Simultaneous calls without ID collision ---

describe("AC2.3: Simultaneous calls without ID collision", () => {
  it("initiator uses positive IDs, acceptor uses negative IDs", async () => {
    const [transportA, transportB] = createLinkedTransports();

    // Spy on both transports to capture actual wire messages
    const sendSpyA = vi.spyOn(transportA, "send");
    const sendSpyB = vi.spyOn(transportB, "send");

    // Common service with methods both sides can call
    const service = {
      add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      },
      multiply(a: number, b: number): Promise<number> {
        return Promise.resolve(a * b);
      },
    };

    const sessionA = rpcSession(transportA, service, { role: "initiator" });
    const sessionB = rpcSession(transportB, service, { role: "acceptor" });

    // Initiator calls: should generate wire-level IDs 1, 2, 3...
    const initiatorCalls = [
      (sessionA.remote as any).add(1, 2),
      (sessionA.remote as any).add(3, 4),
      (sessionA.remote as any).add(5, 6),
    ];

    // Acceptor calls: should generate wire-level IDs -1, -2, -3...
    const acceptorCalls = [
      (sessionB.remote as any).multiply(2, 3),
      (sessionB.remote as any).multiply(4, 5),
      (sessionB.remote as any).multiply(6, 7),
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

    const service = {
      echo(value: number): Promise<number> {
        return Promise.resolve(value);
      },
    };

    const sessionA = rpcSession(transportA, service, { role: "initiator" });
    const sessionB = rpcSession(transportB, service, { role: "acceptor" });

    // Both sides make 5 calls each
    const calls = [];
    for (let i = 0; i < 5; i++) {
      calls.push((sessionA.remote as any).echo(1000 + i));
      calls.push((sessionB.remote as any).echo(2000 + i));
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

// --- AC2.4: Void-returning methods ---

describe("AC2.4: Void-returning methods", () => {
  it("void method resolves to null", async () => {
    const [transportA, transportB] = createLinkedTransports();

    let sideEffectRan = false;
    const acceptorService = {
      sideEffect(): Promise<void> {
        sideEffectRan = true;
        return Promise.resolve();
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    const result = await (sessionA.remote as any).sideEffect();

    expect(sideEffectRan).toBe(true);
    expect(result).toBe(null);

    sessionA.close();
    sessionB.close();
  });

  it("Promise<void> resolves even without explicit return", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      async doWork(): Promise<void> {
        // no explicit return
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    const result = await (sessionA.remote as any).doWork();

    expect(result).toBe(null);

    sessionA.close();
    sessionB.close();
  });
});

// --- AC2.5: Remote method that throws ---

describe("AC2.5: Remote method that throws", () => {
  it("thrown error returns RpcError with code, message, data", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      throwWithData(): Promise<never> {
        const err = new Error("Something went wrong");
        (err as any).code = -32000;
        (err as any).data = { details: "extra info" };
        throw err;
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    try {
      await (sessionA.remote as any).throwWithData();
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

    const acceptorService = {
      throwSimple(): Promise<never> {
        throw new Error("Something broke");
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    try {
      await (sessionA.remote as any).throwSimple();
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

    const acceptorService = {
      throwNoCode(): Promise<never> {
        throw new Error("Basic error");
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    try {
      await (sessionA.remote as any).throwNoCode();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32000);
    }

    sessionA.close();
    sessionB.close();
  });
});

// --- AC2.6: Method that doesn't exist ---

describe("AC2.6: Method not found", () => {
  it("calling non-existent method rejects with -32601", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      existingMethod(): Promise<string> {
        return Promise.resolve("exists");
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    try {
      await (sessionA.remote as any).nonExistentMethod();
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

    // Acceptor has empty service
    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    try {
      await (sessionA.remote as any).anyMethod();
      expect.fail("Should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(-32601);
    }

    sessionA.close();
    sessionB.close();
  });
});

// --- AC2.7: Messages sent individually (no batching) ---

describe("AC2.7: Messages sent individually", () => {
  it("each call sends exactly one message", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const sendSpy = vi.spyOn(transportB, "send");

    const acceptorService = {
      getValue(): Promise<number> {
        return Promise.resolve(42);
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Clear the spy to start fresh
    sendSpy.mockClear();

    await (sessionA.remote as any).getValue();

    // Should be exactly 1 message (the response)
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sessionA.close();
    sessionB.close();
  });

  it("multiple calls send multiple messages immediately", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const sendSpy = vi.spyOn(transportA, "send");

    const initiatorService = {};
    const acceptorService = {
      echo(value: number): Promise<number> {
        return Promise.resolve(value);
      },
    };

    const sessionA = rpcSession(transportA, initiatorService, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Clear the spy to start fresh
    sendSpy.mockClear();

    // Make 3 calls without awaiting yet
    const call1 = (sessionA.remote as any).echo(1);
    const call2 = (sessionA.remote as any).echo(2);
    const call3 = (sessionA.remote as any).echo(3);

    // Each call should have sent a message immediately (3 total)
    // Note: we check after all three are initiated but before any complete
    expect(sendSpy).toHaveBeenCalledTimes(3);

    // Wait for completion
    await Promise.all([call1, call2, call3]);

    sessionA.close();
    sessionB.close();
  });
});

// --- AC3: Connection lifecycle ---

describe("session lifecycle (AC3.1-AC3.4)", () => {
  // AC3.1: Transport closes, pending calls reject with close reason
  it("AC3.1: when transport closes, pending outgoing calls reject with close reason", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves - keeps call pending
        });
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Start a call that will remain pending
    const callPromise = (sessionA.remote as any).slowMethod();

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

  // AC3.2: session.close() rejects pending calls and calls transport.close()
  it("AC3.2: session.close() rejects pending calls and calls transport.close()", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves - keeps call pending
        });
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Spy on transport.close()
    const transportCloseSpy = vi.spyOn(transportA, "close");

    // Start a call that will remain pending
    const callPromise = (sessionA.remote as any).slowMethod();

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

  // AC3.3: Calling session.remote.method() after close rejects immediately
  it("AC3.3: calling session.remote.method() after close rejects immediately", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    // Close the session
    sessionA.close();

    // Try to call a method after close
    try {
      await (sessionA.remote as any).someMethod();
      expect.fail("Call should have rejected immediately");
    } catch (err) {
      expect((err as Error).message).toBe("Session is closed");
    }

    sessionB.close();
  });

  // AC3.4: Transport closes during service method execution, response send failure is handled gracefully
  it("AC3.4: transport close during async service method execution doesn't crash", async () => {
    const [transportA, transportB] = createLinkedTransports();

    let methodStarted = false;
    let methodCompleted = false;

    const acceptorService = {
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

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, {
      role: "acceptor",
      onError(err) {
        onErrorCalled = true;
        errorLogged = err as Error;
      },
    });

    // Start the call
    const callPromise = (sessionA.remote as any).slowAsyncMethod();

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

    const acceptorService = {
      slowMethod(): Promise<string> {
        return new Promise(() => {
          // Never resolves
        });
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    // Start multiple pending calls
    const call1 = (sessionA.remote as any).slowMethod();
    const call2 = (sessionA.remote as any).slowMethod();
    const call3 = (sessionA.remote as any).slowMethod();

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

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    // Close multiple times - should not throw
    sessionA.close();
    sessionA.close();
    sessionA.close();

    // Subsequent calls should still reject
    try {
      await (sessionA.remote as any).anyMethod();
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

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    sessionA.close();

    try {
      await (sessionA.remote as any).anyMethod();
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

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, {}, { role: "acceptor" });

    sessionA.close();

    // sessionA.close() should have called transportA.close()
    expect(transportACloseSpy).toHaveBeenCalled();

    sessionB.close();
  });

  it("rejects pending calls when transport closes", async () => {
    const [transportA, transportB] = createLinkedTransports();

    const acceptorService = {
      slowMethod(): Promise<string> {
        return new Promise((resolve) => {
          setTimeout(() => resolve("done"), 1000);
        });
      },
    };

    const sessionA = rpcSession(transportA, {}, { role: "initiator" });
    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

    const callPromise = (sessionA.remote as any).slowMethod();

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
  // AC4.1: Malformed JSON
  describe("AC4.1: Malformed JSON", () => {
    it("malformed JSON is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

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
      const result = await (sessionA.remote as any).echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  // AC4.2: Unknown response ID
  describe("AC4.2: Unknown response ID", () => {
    it("response with unknown ID is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

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
      const result = await (sessionA.remote as any).echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  // AC4.3: Unroutable message
  describe("AC4.3: Unroutable message", () => {
    it("message that is neither request nor response is logged via onError and session continues", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const acceptorService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

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
      const result = await (sessionA.remote as any).echo("test");
      expect(result).toBe("test");

      sessionA.close();
      sessionB.close();
    });
  });

  // AC4.4: Send failure
  describe("AC4.4: Send failure", () => {
    it("transport.send() throwing rejects only that specific call, not the whole session", async () => {
      // Create a custom transport that fails on the first call only
      let sendCount = 0;
      let messageHandlerA: ((message: string) => void) | null = null;
      let closeHandlerA: ((reason?: Error) => void) | null = null;

      const transportA: RpcMessageTransport = {
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

      const transportB: RpcMessageTransport = {
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

      const acceptorService = {
        echo(value: string): Promise<string> {
          return Promise.resolve(value);
        },
      };

      const sessionA = rpcSession(transportA, {}, { role: "initiator" });
      const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

      // First call should fail because send() throws
      try {
        await (sessionA.remote as any).echo("first");
        expect.fail("First call should have rejected");
      } catch (err) {
        expect((err as Error).message).toBe("Send failed on first call");
      }

      // Second call should succeed because send() no longer throws
      const result = await (sessionA.remote as any).echo("second");
      expect(result).toBe("second");

      // Session is still alive
      const result2 = await (sessionA.remote as any).echo("third");
      expect(result2).toBe("third");

      sessionA.close();
      sessionB.close();
    });
  });

  // AC4.5: Incoming notification
  describe("AC4.5: Incoming notification", () => {
    it("incoming notification is not executed and is logged via onError", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      let handlerWasCalled = false;

      const initiatorService = {
        testMethod(): Promise<void> {
          handlerWasCalled = true;
          return Promise.resolve();
        },
      };

      const sessionA = rpcSession(transportA, initiatorService, {
        role: "initiator",
        onError(err) {
          errors.push(err);
        },
      });

      const sessionB = rpcSession(
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

  // AC4.6: Invalid message (non-object)
  describe("AC4.6: Non-object message", () => {
    it("non-object JSON is logged via onError with INVALID_MESSAGE code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = rpcSession(
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
      const result = await (sessionA.remote as any).echo("ok");
      expect(result).toBe("ok");

      sessionA.close();
      sessionB.close();
    });
  });

  // AC4.7: Invalid response shape
  describe("AC4.7: Invalid response", () => {
    it("response that fails type guard is logged with INVALID_RESPONSE code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = rpcSession(
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

  // AC4.8: Null response ID
  describe("AC4.8: Null response ID", () => {
    it("response with null ID is logged with NULL_RESPONSE_ID code", async () => {
      const [transportA, transportB] = createLinkedTransports();

      const errors: unknown[] = [];
      const sessionA = rpcSession(
        transportA,
        {},
        {
          role: "initiator",
          onError(err) {
            errors.push(err);
          },
        },
      );

      const sessionB = rpcSession(
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

    const errorLog: unknown[] = [];
    const sessionA = rpcSession(
      transportA,
      {},
      {
        role: "initiator",
        onError(err) {
          errorLog.push(err);
        },
      },
    );

    const acceptorService = {
      echo(value: string): Promise<string> {
        return Promise.resolve(value);
      },
    };

    const sessionB = rpcSession(transportB, acceptorService, { role: "acceptor" });

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
    const result1 = await (sessionA.remote as any).echo("recovery1");
    const result2 = await (sessionA.remote as any).echo("recovery2");
    const result3 = await (sessionA.remote as any).echo("recovery3");

    expect(result1).toBe("recovery1");
    expect(result2).toBe("recovery2");
    expect(result3).toBe("recovery3");

    sessionA.close();
    sessionB.close();
  });
});
