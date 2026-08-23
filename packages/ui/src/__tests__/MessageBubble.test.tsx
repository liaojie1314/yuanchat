/**
 * MessageBubble 贴纸渲染与「添加到表情」菜单项测试
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import i18n from "@yuanchat/design-system/i18n";
import { MessageBubble } from "../MessageBubble";
import type { ChatMessage } from "@yuanchat/shared";

/**
 * 菜单项文案取当前语言的实际译文，而非正则匹配。
 *
 * @remarks 原实现用 `/add.*sticker|添加到表情/i` 定位——该正则恰好也匹配**原始 key**
 *   `sticker.addToStickers`（"add" + "Sticker"），于是 i18n key 写错、UI 显示原始 key
 *   时测试照样通过（假绿）。这里额外断言译文 ≠ key 本身，
 *   locale 缺该 key 时 i18next 回落成 key，正好被这条断言抓住。
 */
function label(key: string): string {
  const text = i18n.t(key);
  expect(text).not.toBe(key);
  return text;
}

// 打桩 shared 模块
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    getDownloadUrl: vi.fn(async (key: string) => "https://signed/" + key),
    showToast: vi.fn(),
  };
});

describe("sticker rendering and add-to-favorites menu item", () => {
  it("renders sticker without bubble padding/background", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "sticker",
      isSelf: false,
      sticker: { key: "images/x.png", width: 96, height: 96 },
      time: "10:00",
      seq: 1,
    };
    const { container } = render(<MessageBubble msg={msg} />);
    // 贴纸容器不应带 msg-bubble-self/msg-bubble-peer 背景类
    const bubbleDiv = container.querySelector(".msg-bubble-peer, .msg-bubble-self");
    expect(bubbleDiv).toBeNull();
  });

  it("shows add-to-sticker menu item only for image messages with onAddSticker", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "image",
      isSelf: false,
      senderName: "Bob",
      image: { key: "images/x.png", width: 200, height: 200 },
      time: "10:00",
      seq: 1,
    };
    const onAddSticker = vi.fn();
    const { container } = render(<MessageBubble msg={msg} onAddSticker={onAddSticker} />);

    // 定位图片气泡容器（p-1.5 + rounded-lg 的那层）
    const bubble = container.querySelector(".msg-bubble-peer");
    expect(bubble).toBeTruthy();
    fireEvent.contextMenu(bubble!);

    const item = screen.getByRole("menuitem", { name: label("sticker.addToStickers") });
    fireEvent.click(item);
    expect(onAddSticker).toHaveBeenCalledTimes(1);
  });

  it("hides add-to-sticker menu item when onAddSticker is not provided", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "image",
      isSelf: false,
      senderName: "Bob",
      image: { key: "images/x.png", width: 200, height: 200 },
      time: "10:00",
      seq: 1,
    };
    const { container } = render(<MessageBubble msg={msg} />);
    fireEvent.contextMenu(container.querySelector(".msg-bubble-peer")!);

    expect(
      screen.queryByRole("menuitem", { name: label("sticker.addToStickers") }),
    ).not.toBeInTheDocument();
  });

  it("sticker messages have no onClick lightbox handler (excluded from image viewer flow)", async () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "sticker",
      isSelf: false,
      sticker: { key: "images/x.png", width: 96, height: 96 },
      time: "10:00",
      seq: 1,
    };
    const onImageClick = vi.fn();
    const { container } = render(<MessageBubble msg={msg} onImageClick={onImageClick} />);

    // 必须等签名 URL 落地后再点：原实现用 `if (img) click` 兜底，而 <img> 只在
    // getDownloadUrl resolve 后才渲染，同步查询恒为 null → 断言从未真正点到过东西
    await vi.waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });
    fireEvent.click(container.querySelector("img")!);
    expect(onImageClick).not.toHaveBeenCalled();
  });
});
