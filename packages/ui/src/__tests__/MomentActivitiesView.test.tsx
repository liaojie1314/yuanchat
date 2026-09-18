/**
 * MomentActivitiesView 测试
 *
 * 覆盖：挂载即拉列表并标记已读、赞/评论两种行文案、空态、点行回信息流。
 *
 * jsdom 默认 locale 钉在 en-US（见 setup.ts），故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MomentActivitiesView } from "../moments/MomentActivitiesView";
import { useMomentsStore } from "@yuanchat/shared";
import type { MomentActivity } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, getDownloadUrl: vi.fn(async (k: string) => "blob:" + k) };
});

function makeActivity(overrides: Partial<MomentActivity> = {}): MomentActivity {
  return {
    id: "a1",
    kind: 1,
    postId: "p1",
    actor: { id: "u2", nickname: "Bob", avatarUrl: "", statusEmoji: "" },
    commentPreview: "",
    postPreview: "今天天气不错",
    postThumbKey: "",
    read: false,
    createdAt: "2026-09-13T10:00:00Z",
    ...overrides,
  };
}

function setStore(activities: MomentActivity[]) {
  const loadActivities = vi.fn(async () => {});
  const markRead = vi.fn(async () => {});
  useMomentsStore.setState({ activities, unreadCount: 0, loadActivities, markRead });
  return { loadActivities, markRead };
}

function renderActivities() {
  return render(
    <MemoryRouter initialEntries={["/moments/activities"]}>
      <Routes>
        <Route path="/moments" element={<div>feed-probe</div>} />
        <Route path="/moments/activities" element={<MomentActivitiesView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MomentActivitiesView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("挂载时拉列表并标记已读", () => {
    const { loadActivities, markRead } = setStore([makeActivity()]);
    renderActivities();
    expect(loadActivities).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("点赞行显示赞文案，评论行显示评论预览", () => {
    setStore([
      makeActivity(),
      makeActivity({
        id: "a2",
        kind: 2,
        commentPreview: "说得好",
        actor: { id: "u3", nickname: "Cara", avatarUrl: "", statusEmoji: "" },
      }),
    ]);
    renderActivities();

    expect(screen.getByText("liked your moment")).toBeInTheDocument();
    expect(screen.getByText("说得好")).toBeInTheDocument();
    expect(screen.getByText("Cara")).toBeInTheDocument();
  });

  it("空态提示（先骨架后空态）", async () => {
    setStore([]);
    renderActivities();
    expect(screen.getByTestId("activities-skeleton")).toBeInTheDocument();
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("点一行回信息流", async () => {
    setStore([makeActivity()]);
    renderActivities();
    fireEvent.click(screen.getByText("Bob"));
    expect(await screen.findByText("feed-probe")).toBeInTheDocument();
  });
});
