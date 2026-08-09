/**
 * ChatWindow 群公告横幅 + AnnouncementDialog 全文弹层测试
 *
 * 只覆盖公告相关交互；消息流本身走 EmptyMessages 分支（显式置空消息列表），
 * 避免虚拟滚动布局在 jsdom 下的不确定性影响断言。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWindow } from "../ChatWindow";
import { useAuthStore, useConversationStore, useMessageStore } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    // Composer 的群成员拉取（@ 提及用）在真实模式下会打真实网络请求；
    // mock 模式下直接跳过，测试无关不再单独打桩 fetchMembers
    isMockEnabled: () => true,
  };
});

const ANNOUNCEMENT_TEXT = "周五 15:00 发布评审，请提前更新进度看板";

const GROUP_CONV: Conversation = {
  id: "g1",
  type: "group",
  name: "研发群",
  unreadCount: 0,
  isMuted: false,
  memberCount: 5,
  announcement: ANNOUNCEMENT_TEXT,
  announcementUpdatedAt: "2026-08-01T09:00:00+08:00",
};

function setupStores(conv: Conversation) {
  useAuthStore.setState({ user: { id: "self", nickname: "Me" } });
  useConversationStore.setState({ activeId: conv.id, conversations: [conv] });
  useMessageStore.setState({
    messagesByConv: { [conv.id]: [] },
    hasMoreByConv: { [conv.id]: false },
    typingByConv: {},
    replyingTo: null,
  });
}

describe("ChatWindow announcement banner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the announcement banner text for group chats with an announcement", () => {
    setupStores(GROUP_CONV);
    render(<ChatWindow />);
    expect(screen.getByText(ANNOUNCEMENT_TEXT)).toBeInTheDocument();
  });

  it("does not show a banner when the group has no announcement", () => {
    setupStores({ ...GROUP_CONV, announcement: undefined, announcementUpdatedAt: undefined });
    render(<ChatWindow />);
    expect(screen.queryByText(ANNOUNCEMENT_TEXT)).toBeNull();
  });

  it("does not show a banner for private chats even with a stray announcement value", () => {
    setupStores({
      id: "p1",
      type: "private",
      name: "张三",
      unreadCount: 0,
      isMuted: false,
      announcement: ANNOUNCEMENT_TEXT,
      announcementUpdatedAt: "2026-08-01T09:00:00+08:00",
    });
    render(<ChatWindow />);
    expect(screen.queryByText(ANNOUNCEMENT_TEXT)).toBeNull();
  });

  it("opens the full-text dialog when the banner is clicked", () => {
    setupStores(GROUP_CONV);
    render(<ChatWindow />);
    fireEvent.click(screen.getByText(ANNOUNCEMENT_TEXT));
    // 横幅本身 + 弹层正文，两处都渲染完整文本
    expect(screen.getAllByText(ANNOUNCEMENT_TEXT).length).toBeGreaterThanOrEqual(2);
  });

  it("marks localStorage as read (with announcementUpdatedAt) when the banner is opened", () => {
    setupStores(GROUP_CONV);
    render(<ChatWindow />);
    fireEvent.click(screen.getByText(ANNOUNCEMENT_TEXT));
    expect(localStorage.getItem("announcement-read:g1")).toBe("2026-08-01T09:00:00+08:00");
  });
});
