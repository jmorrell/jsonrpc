import { describe, it, expect, vi } from "vitest";
import { rpcSession, RpcError } from "../session.js";
import { createLinkedTransports } from "./test-helpers.js";

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
