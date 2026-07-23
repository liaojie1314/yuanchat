import { describe, it, expect, vi, beforeEach } from "vitest";

// We test indirectly by checking captureException is called
describe("API 5xx Sentry reporting", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls captureException on 5xx response", async () => {
    const mockCapture = vi.fn();
    vi.doMock("../observability/sentry", () => ({
      captureException: mockCapture,
    }));
    const { apiGet } = await import("../api/client");
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ code: 0, data: null }),
    });
    await apiGet("/test").catch(() => {});
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ status: 500 }),
    );
  });

  it("does NOT call captureException on 4xx response", async () => {
    const mockCapture = vi.fn();
    vi.doMock("../observability/sentry", () => ({
      captureException: mockCapture,
    }));
    const { apiGet } = await import("../api/client");
    global.fetch = vi.fn().mockResolvedValue({
      status: 400,
      json: async () => ({ code: 400, message: "Bad Request", data: null }),
    });
    await apiGet("/test").catch(() => {});
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
