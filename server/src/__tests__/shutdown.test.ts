import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createShutdown } from "../shutdown.js";

function makeDeps(overrides: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  return {
    server: { close: vi.fn((cb: (err?: Error) => void) => cb()) },
    logger: { info: vi.fn(), error: vi.fn() },
    embeddedPostgres: null,
    embeddedPostgresStartedByThisProcess: false,
    timeoutMs: 100,
    ...overrides,
  };
}

describe("createShutdown", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    exitSpy?.mockRestore();
  });

  it("closes server then calls process.exit(0) on clean shutdown", async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const deps = makeDeps();
    const shutdown = createShutdown(deps);

    await expect(shutdown("SIGINT")).rejects.toThrow("exit");

    expect(deps.server.close).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("stops embedded postgres when started by this process", async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      embeddedPostgres: { stop: mockStop },
      embeddedPostgresStartedByThisProcess: true,
    });
    const shutdown = createShutdown(deps);

    await expect(shutdown("SIGTERM")).rejects.toThrow("exit");

    expect(mockStop).toHaveBeenCalledOnce();
  });

  it("skips embedded postgres stop when not started by this process", async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      embeddedPostgres: { stop: mockStop },
      embeddedPostgresStartedByThisProcess: false,
    });
    const shutdown = createShutdown(deps);

    await expect(shutdown("SIGINT")).rejects.toThrow("exit");

    expect(mockStop).not.toHaveBeenCalled();
  });

  it("logs and continues when server.close errors", async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const closeError = new Error("close failed");
    const deps = makeDeps({
      server: { close: vi.fn((cb: (err?: Error) => void) => cb(closeError)) },
    });
    const shutdown = createShutdown(deps);

    await expect(shutdown("SIGINT")).rejects.toThrow("exit");

    expect(deps.logger.error).toHaveBeenCalledWith({ err: closeError }, "Error closing HTTP server");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("calls process.exit(1) when shutdown times out", async () => {
    vi.useFakeTimers();
    // Use a non-throwing mock so the timer callback completes cleanly
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    let closeCallback: ((err?: Error) => void) | undefined;
    const deps = makeDeps({
      server: {
        close: vi.fn((cb: (err?: Error) => void) => {
          closeCallback = cb; // capture but never call
        }),
      },
      timeoutMs: 100,
    });
    const shutdown = createShutdown(deps);

    const promise = shutdown("SIGINT");
    await vi.advanceTimersByTimeAsync(100);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(deps.logger.error).toHaveBeenCalledWith("Graceful shutdown timed out; forcing exit");

    // Resolve the hanging close to clean up the promise
    closeCallback?.();
    await promise;

    vi.useRealTimers();
  });

  it("calls closeAllConnections when available", async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const closeAllConnections = vi.fn();
    const deps = makeDeps({
      server: { close: vi.fn((cb: (err?: Error) => void) => cb()), closeAllConnections },
    });
    const shutdown = createShutdown(deps);

    await expect(shutdown("SIGINT")).rejects.toThrow("exit");

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(deps.server.close).toHaveBeenCalledOnce();
  });
});
