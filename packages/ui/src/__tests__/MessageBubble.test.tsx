/**
 * MessageBubble 贴纸渲染与「添加到表情」菜单项测试
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";
import type { ChatMessage } from "@yuanchat/shared";

// Mock shared module
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

    // Find the bubble container with image bubble styling (p-1.5 + rounded-2xl)
    const bubble = container.querySelector(".msg-bubble-peer");
    expect(bubble).toBeTruthy();
    fireEvent.contextMenu(bubble!);

    const item = screen.queryByRole("menuitem", { name: /add.*sticker|添加到表情/i });
    expect(item).toBeTruthy();
    if (item) {
      fireEvent.click(item);
      expect(onAddSticker).toHaveBeenCalled();
    }
  });

  it("sticker messages have no onClick lightbox handler (excluded from image viewer flow)", () => {
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
    render(<MessageBubble msg={msg} onImageClick={onImageClick} />);

    const img = screen.queryByRole("img");
    if (img) fireEvent.click(img);
    expect(onImageClick).not.toHaveBeenCalled();
  });
});
