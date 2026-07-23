import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({})),
  replayIntegration: vi.fn(() => ({})),
}));

describe("sentry", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("initSentry does nothing when dsn is empty", async () => {
    const { initSentry } = await import("../observability/sentry");
    const Sentry = await import("@sentry/react");
    expect(() => initSentry({ dsn: "", release: "1.0.0", environment: "test" })).not.toThrow();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initSentry does nothing when dsn is undefined", async () => {
    const { initSentry } = await import("../observability/sentry");
    const Sentry = await import("@sentry/react");
    expect(() => initSentry({ release: "1.0.0", environment: "test" })).not.toThrow();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("captureException falls back to console.error when not initialized", async () => {
    const { captureException } = await import("../observability/sentry");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("test error");
    captureException(err);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
