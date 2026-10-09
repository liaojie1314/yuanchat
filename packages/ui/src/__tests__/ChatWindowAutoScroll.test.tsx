/**
 * ChatWindow 发消息自动滚动到底部测试
 *
 * 只覆盖一条：**用户已经不在底部时，自己发出的消息仍必须把视口拉到底**。
 *
 * 为什么单独测：手机端软键盘弹起会改视口高度、顺带触发一次 onScroll，
 * distFromBottom 被算成一大截 → isAtBottomRef 翻成 false → 发完消息不滚，
 * 自己刚发的消息留在屏幕外。桌面端键盘不动视口，所以这个 bug 只在手机上犯，
 * 也就只能靠「人为把滚动位置挪离底部」在单测里复现。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { ChatWindow } from "../chat/ChatWindow";
import { useAuthStore, useConversationStore, useMessageStore } from "@yuanchat/shared";
import type { ChatMessage, Conversation } from "@yuanchat/shared";

const scrollToIndex = vi.fn();

// 同 ChatWindowEditSave.test.tsx：jsdom 下容器高度恒为 0，真实 useVirtualizer
// 算不出任何可见行。这里换成全可见的最小替身，并把 scrollToIndex 换成 spy。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 80,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * 80,
        size: 80,
      })),
    measureElement: () => undefined,
    scrollToIndex,
  }),
}));

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, isMockEnabled: () => true };
});

const CONV: Conversation = {
  id: "c1",
  type: "private",
  name: "Bob",
  unreadCount: 0,
  isMuted: false,
};

/** 造一条消息；isSelf 决定是自己发的还是对方发的 */
function msg(id: string, seq: number, isSelf: boolean): ChatMessage {
  return {
    id,
    conversationId: CONV.id,
    kind: "text",
    text: id,
    isSelf,
    seq,
    status: isSelf ? "sent" : undefined,
    createdAtMs: Date.now(),
    time: "10:00",
  };
}

function setMessages(list: ChatMessage[]) {
  useMessageStore.setState({ messagesByConv: { [CONV.id]: list } });
}

/**
 * 把滚动容器伪装成「已向上翻了 900px」并触发一次 onScroll。
 *
 * jsdom 里 scrollHeight/clientHeight 恒为 0，不改这几个值的话
 * distFromBottom 永远是 0，isAtBottomRef 一直是 true，测不出任何东西。
 */
function scrollAwayFromBottom(container: HTMLElement) {
  const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
  expect(scroller).toBeTruthy();
  Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 0, configurable: true });
  fireEvent.scroll(scroller);
}

describe("ChatWindow 自动滚动到底部", () => {
  beforeEach(() => {
    scrollToIndex.mockReset();
    useAuthStore.setState({ user: { id: "self", nickname: "Me" } });
    useConversationStore.setState({ activeId: CONV.id, conversations: [CONV] });
    useMessageStore.setState({
      messagesByConv: { [CONV.id]: [msg("m1", 1, false)] },
      hasMoreByConv: { [CONV.id]: false },
      typingByConv: {},
      replyingTo: null,
      composerInsert: "",
    });
  });

  it("离开底部后，自己发出的消息仍滚到底（手机端软键盘场景）", () => {
    const { container } = render(<ChatWindow />);
    scrollAwayFromBottom(container);
    scrollToIndex.mockReset();

    act(() => setMessages([msg("m1", 1, false), msg("m2", 2, true)]));
    expect(scrollToIndex).toHaveBeenCalledWith(1, expect.objectContaining({ align: "end" }));
  });

  it("离开底部后，对方发来的消息不打断阅读，不滚", () => {
    const { container } = render(<ChatWindow />);
    scrollAwayFromBottom(container);
    scrollToIndex.mockReset();

    act(() => setMessages([msg("m1", 1, false), msg("m2", 2, false)]));
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("仍在底部时，对方来消息照常滚到底", () => {
    render(<ChatWindow />);
    scrollToIndex.mockReset();

    act(() => setMessages([msg("m1", 1, false), msg("m2", 2, false)]));
    expect(scrollToIndex).toHaveBeenCalledWith(1, expect.objectContaining({ align: "end" }));
  });
});
