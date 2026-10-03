import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const reconcile = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../store/messageLocalSync", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, reconcileConversation: reconcile };
});

import { reconcileOnForeground, __resetForegroundReconcile } from "../store/localStoreLifecycle";
import { useAuthStore } from "../store/authStore";
import { useConversationStore } from "../store/conversationStore";

/** 登录态 + 打开某个会话 */
function signedInWith(convId: string | null) {
  useAuthStore.setState({ user: { id: "u1", nickname: "我", shortId: 1 } } as never);
  useConversationStore.setState({ activeId: convId });
}

beforeEach(() => {
  reconcile.mockClear();
  __resetForegroundReconcile();
  vi.useFakeTimers();
  signedInWith("c1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reconcileOnForeground", () => {
  it("回前台给当前会话对一次账", () => {
    reconcileOnForeground();
    expect(reconcile).toHaveBeenCalledWith("c1", "u1");
  });

  it("30 秒内重复回前台只对一次账，切 tab 来回弹不该打服务端", () => {
    reconcileOnForeground();
    vi.advanceTimersByTime(29_000);
    reconcileOnForeground();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("超过 30 秒再回前台重新对账", () => {
    reconcileOnForeground();
    vi.advanceTimersByTime(31_000);
    reconcileOnForeground();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("没有打开任何会话时不对账，且不消耗节流窗口", () => {
    signedInWith(null);
    reconcileOnForeground();
    expect(reconcile).not.toHaveBeenCalled();

    signedInWith("c1");
    reconcileOnForeground();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("未登录时不对账", () => {
    useAuthStore.setState({ user: null } as never);
    reconcileOnForeground();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
