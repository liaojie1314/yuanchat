/**
 * MomentsScreen 测试
 *
 * 覆盖：挂载拉首页、加载骨架/空态/错误重试、删除走 ConfirmDialog 二次确认、
 * 铃铛未读角标与跳转、个人页模式按 userId 拉他人动态。
 *
 * jsdom 默认 locale 钉在 en-US（见 setup.ts），故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MomentsScreen } from "../moments/MomentsScreen";
import { useMomentsStore } from "@yuanchat/shared";
import * as shared from "@yuanchat/shared";
import type { MomentPost } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    fetchUserPosts: vi.fn(),
    getDownloadUrl: vi.fn(async (k: string) => "blob:" + k),
  };
});

function makePost(overrides: Partial<MomentPost> = {}): MomentPost {
  return {
    id: "p1",
    user: { id: "u1", nickname: "Alice", avatarUrl: "", statusEmoji: "" },
    content: "hello",
    mediaKind: 0,
    media: [],
    visibility: 0,
    likeCount: 0,
    likedByMe: false,
    likes: [],
    comments: [],
    createdAt: "2026-09-13T10:00:00Z",
    deletable: true,
    ...overrides,
  };
}

/** 用可控的 action 替换 store，避免用例触到真实网络 */
function setStore(partial: Partial<ReturnType<typeof useMomentsStore.getState>>) {
  useMomentsStore.setState({
    posts: [],
    nextCursor: "",
    hasMore: false,
    loading: false,
    unreadCount: 0,
    activities: [],
    loadFeed: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    toggleLike: vi.fn(async () => {}),
    comment: vi.fn(async () => {}),
    removePost: vi.fn(async () => {}),
    removeComment: vi.fn(async () => {}),
    loadActivities: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    ...partial,
  });
}

function renderScreen(userId?: string) {
  return render(
    <MemoryRouter initialEntries={["/moments"]}>
      <Routes>
        <Route path="/moments" element={<MomentsScreen userId={userId} />} />
        <Route path="/moments/compose" element={<div>compose-probe</div>} />
        <Route path="/moments/activities" element={<div>activities-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MomentsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStore({});
  });

  it("挂载时拉首页并渲染帖子", async () => {
    const loadFeed = vi.fn(async () => {});
    setStore({ loadFeed, posts: [makePost({ content: "今天天气不错" })] });
    renderScreen();

    expect(loadFeed).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("今天天气不错")).toBeInTheDocument();
  });

  it("首屏加载中渲染固定高度骨架卡", () => {
    setStore({ loading: true, posts: [] });
    renderScreen();
    expect(screen.getAllByTestId("moment-skeleton")).toHaveLength(3);
  });

  it("空态提示并提供发布入口", async () => {
    renderScreen();
    expect(await screen.findByText("No moments yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByText("compose-probe")).toBeInTheDocument();
  });

  it("加载失败显示重试，点击重新拉取", async () => {
    const loadFeed = vi.fn(async () => {
      throw new Error("boom");
    });
    setStore({ loadFeed });
    renderScreen();

    expect(await screen.findByText("Failed to load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loadFeed).toHaveBeenCalledTimes(2));
  });

  it("删除动态先弹二次确认，确认后才真正删除", async () => {
    const removePost = vi.fn(async () => {});
    setStore({ removePost, posts: [makePost()] });
    renderScreen();

    fireEvent.click(await screen.findByLabelText("Delete"));
    expect(removePost).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this moment?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(removePost).toHaveBeenCalledWith("p1"));
  });

  it("取消二次确认不删除", async () => {
    const removePost = vi.fn(async () => {});
    setStore({ removePost, posts: [makePost()] });
    renderScreen();

    fireEvent.click(await screen.findByLabelText("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removePost).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete this moment?")).toBeNull();
  });

  it("未读互动显示角标，点铃铛进互动页", async () => {
    setStore({ unreadCount: 5 });
    renderScreen();

    expect(screen.getByTestId("moments-unread").textContent).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText("activities-probe")).toBeInTheDocument();
  });

  it("个人页模式按 userId 拉他人动态，不走信息流 store", async () => {
    const loadFeed = vi.fn(async () => {});
    setStore({ loadFeed });
    vi.mocked(shared.fetchUserPosts).mockResolvedValue({
      posts: [makePost({ id: "p9", content: "他的动态" })],
      nextCursor: "",
    });

    renderScreen("u2");

    expect(await screen.findByText("他的动态")).toBeInTheDocument();
    expect(shared.fetchUserPosts).toHaveBeenCalledWith("u2");
    expect(loadFeed).not.toHaveBeenCalled();
  });
});
