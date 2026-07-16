/**
 * tokenManager 单元测试
 *
 * 验证静默刷新协调器：
 * - 新鲜 token 不触发刷新
 * - 临近过期（<60s）触发主动刷新
 * - 单飞行：并发调用共享同一刷新 Promise
 * - forceRefresh 无条件刷新（401 兜底）
 * - 无 handler / 无过期信息时安全返回
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setRefreshHandler,
  ensureFreshToken,
  forceRefresh,
  needsRefresh,
} from "../api/tokenManager";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
});

afterEach(() => {
  setRefreshHandler(null);
  vi.useRealTimers();
});

describe("tokenManager", () => {
  it("does not refresh when token is fresh", async () => {
    const refresh = vi.fn().mockResolvedValue("new-token");
    setRefreshHandler({
      getExpiresAt: () => Date.now() + 10 * 60_000, // 10 分钟后过期
      refresh,
    });

    expect(needsRefresh()).toBe(false);
    const result = await ensureFreshToken();
    expect(result).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when token expires within 60s", async () => {
    const refresh = vi.fn().mockResolvedValue("new-token");
    setRefreshHandler({
      getExpiresAt: () => Date.now() + 30_000, // 30 秒后过期
      refresh,
    });

    expect(needsRefresh()).toBe(true);
    const result = await ensureFreshToken();
    expect(result).toBe("new-token");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when token is already expired", async () => {
    const refresh = vi.fn().mockResolvedValue("new-token");
    setRefreshHandler({
      getExpiresAt: () => Date.now() - 1000,
      refresh,
    });

    const result = await ensureFreshToken();
    expect(result).toBe("new-token");
  });

  it("deduplicates concurrent refresh calls (single-flight)", async () => {
    let resolveRefresh: (v: string) => void = () => {};
    const refresh = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    setRefreshHandler({
      getExpiresAt: () => Date.now() - 1000,
      refresh,
    });

    const p1 = ensureFreshToken();
    const p2 = ensureFreshToken();
    const p3 = forceRefresh();

    resolveRefresh("shared-token");
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(r1).toBe("shared-token");
    expect(r2).toBe("shared-token");
    expect(r3).toBe("shared-token");
  });

  it("allows a new refresh after the previous one settles", async () => {
    const refresh = vi.fn().mockResolvedValue("token");
    setRefreshHandler({
      getExpiresAt: () => Date.now() - 1000,
      refresh,
    });

    await forceRefresh();
    await forceRefresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh returns null when handler reports failure", async () => {
    const refresh = vi.fn().mockResolvedValue(null); // refresh token 也失效
    setRefreshHandler({
      getExpiresAt: () => Date.now() - 1000,
      refresh,
    });

    const result = await forceRefresh();
    expect(result).toBeNull();
  });

  it("is a no-op without a registered handler", async () => {
    setRefreshHandler(null);
    expect(needsRefresh()).toBe(false);
    expect(await ensureFreshToken()).toBeNull();
    expect(await forceRefresh()).toBeNull();
  });

  it("does not refresh when expiry is unknown (logged out)", async () => {
    const refresh = vi.fn();
    setRefreshHandler({ getExpiresAt: () => null, refresh });

    expect(needsRefresh()).toBe(false);
    expect(await ensureFreshToken()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
