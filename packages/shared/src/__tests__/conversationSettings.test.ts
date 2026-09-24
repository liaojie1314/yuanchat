/**
 * applyConversationSetting 单测：乐观更新 / 失败回滚 / mock 跳过
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyConversationSetting } from "../conversationSettings";
import { useConversationStore } from "../store/conversationStore";
import { useToastStore } from "../store/toastStore";

vi.mock("../api/chat", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../api/chat")>();
  return { ...mod, updateConversationSettings: vi.fn() };
});
vi.mock("../hooks/useChatBootstrap", () => ({ isMockEnabled: vi.fn(() => false) }));

import { updateConversationSettings } from "../api/chat";
import { isMockEnabled } from "../hooks/useChatBootstrap";

const CONV = {
  id: "c1",
  type: "private" as const,
  name: "张三",
  unreadCount: 0,
  isMuted: false,
  isPinned: false,
};

beforeEach(() => {
  vi.mocked(updateConversationSettings).mockReset();
  vi.mocked(isMockEnabled).mockReturnValue(false);
  useConversationStore.setState({ conversations: [{ ...CONV }], activeId: null });
  useToastStore.setState({ toasts: [] });
});

describe("applyConversationSetting", () => {
  it("optimistically pins with local pinnedAt and calls API", async () => {
    vi.mocked(updateConversationSettings).mockResolvedValue({
      is_pinned: true,
      pinned_at: "2026-07-31T09:00:00+08:00",
      is_muted: false,
    });
    const p = applyConversationSetting("c1", { isPinned: true });
    // 乐观：await 前已生效
    const conv = useConversationStore.getState().conversations[0];
    expect(conv.isPinned).toBe(true);
    expect(conv.pinnedAt).toBeTruthy();
    await p;
    expect(updateConversationSettings).toHaveBeenCalledWith("c1", { is_pinned: true });
  });

  it("reverts and toasts on API failure", async () => {
    vi.mocked(updateConversationSettings).mockRejectedValue(new Error("boom"));
    await applyConversationSetting("c1", { isMuted: true });
    const conv = useConversationStore.getState().conversations[0];
    expect(conv.isMuted).toBe(false); // 已回滚
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
  });

  it("skips API entirely in mock mode", async () => {
    vi.mocked(isMockEnabled).mockReturnValue(true);
    await applyConversationSetting("c1", { isPinned: true });
    expect(useConversationStore.getState().conversations[0].isPinned).toBe(true);
    expect(updateConversationSettings).not.toHaveBeenCalled();
  });

  it("no-ops on unknown conversation", async () => {
    await applyConversationSetting("nope", { isPinned: true });
    expect(updateConversationSettings).not.toHaveBeenCalled();
  });
});
