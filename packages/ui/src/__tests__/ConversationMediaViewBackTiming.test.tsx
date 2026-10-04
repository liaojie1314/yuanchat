/**
 * 返回键时序回归：大图层刚提交就按返回，必须关大图层而不是整个相册
 *
 * 等待方式刻意用裸 MutationObserver（RTL 的 waitFor 内部同款）：它的回调是
 * DOM 变更所在任务末尾的微任务，早于 React 冲洗 passive effect 的宏任务。
 * 拦截器若注册在 useEffect 里，这一刻命中的还是 lightbox 为 null 的旧闭包，
 * 于是关错层 —— 远程 CI 上该窗口被负载拉开后，相册用例稳定超时。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversationMediaView } from "../chat/ConversationMediaView";
import * as shared from "@yuanchat/shared";
import type { MediaItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    fetchConversationMedia: vi.fn(),
    getDownloadUrl: vi.fn(async (key: string) => "https://signed/" + key),
    resolveObjectUrl: vi.fn(async (key: string) => "https://signed/" + key),
    showToast: vi.fn(),
  };
});

/** 等到选择器命中，走微任务级的 MutationObserver，不触发 act 冲洗 */
function observeFor(selector: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve();
    const timer = setTimeout(() => {
      obs.disconnect();
      reject(new Error("timeout waiting for " + selector));
    }, 2000);
    const obs = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        clearTimeout(timer);
        obs.disconnect();
        resolve();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

const item: MediaItem = {
  messageId: "m1",
  seq: 1,
  messageType: 2,
  senderNickname: "Bob",
  createdAt: "2026-09-02T10:00:00+08:00",
  key: "images/2026/09/1.jpg",
  width: 800,
  height: 600,
};

describe("ConversationMediaView 返回键时序", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.fetchConversationMedia).mockResolvedValue({
      items: [item],
      hasMore: false,
    });
  });

  it("大图层 DOM 刚提交即按返回，关的是大图层而非相册", async () => {
    const onClose = vi.fn();
    render(<ConversationMediaView conversationId="c1" onClose={onClose} />);

    const card = await screen.findByTestId("media-image-1");
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());
    fireEvent.click(card);

    // 只等 DOM，不等副作用冲洗
    await observeFor('[role="dialog"][aria-label="Image"]');

    expect(shared.runBackInterceptors()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
