/**
 * StickerMineView 我发布的页面测试
 *
 * 覆盖核心交互：列表渲染与编辑入口、删除二次确认（确认后调接口并摘除、
 * 失败保留原项）、空态引导去发布。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StickerMineView } from "../stickers/StickerMineView";
import * as shared from "@yuanchat/shared";
import type { MyPackItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    listMyPacks: vi.fn(),
    deleteStickerPack: vi.fn(),
    showToast: vi.fn(),
  };
});

function myPack(overrides: Partial<MyPackItem> = {}): MyPackItem {
  return {
    id: "p1",
    name: "我的包",
    cover_url: null,
    owner_name: "E2E",
    is_official: false,
    sticker_count: 6,
    created_at: "2026-08-30T10:00:00Z",
    is_owner: true,
    ...overrides,
  };
}

function renderMine() {
  return render(
    <MemoryRouter initialEntries={["/stickers/mine"]}>
      <Routes>
        <Route path="/stickers" element={<div>market-probe</div>} />
        <Route path="/stickers/publish" element={<div>publish-probe</div>} />
        <Route path="/stickers/mine" element={<StickerMineView />} />
        <Route path="/stickers/:packId/edit" element={<div>edit-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StickerMineView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listMyPacks).mockResolvedValue([myPack()]);
    vi.mocked(shared.deleteStickerPack).mockResolvedValue(undefined);
  });

  it("lists published packs with edit and delete entries", async () => {
    renderMine();

    expect(await screen.findByText("我的包")).toBeInTheDocument();
    expect(screen.getByText("6 stickers")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete pack" })).toBeInTheDocument();
  });

  it("navigates to the edit page from the entry", async () => {
    renderMine();

    fireEvent.click(await screen.findByRole("link", { name: "Edit" }));

    expect(await screen.findByText("edit-probe")).toBeInTheDocument();
  });

  it("deletes a pack after confirmation and removes it from the list", async () => {
    renderMine();

    // 先弹确认框，不点确认不删
    fireEvent.click(await screen.findByRole("button", { name: "Delete pack" }));
    expect(shared.deleteStickerPack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(shared.deleteStickerPack).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByText("我的包")).not.toBeInTheDocument());
    expect(shared.showToast).toHaveBeenCalledWith("info", "Deleted");
  });

  it("keeps the pack and toasts when deletion fails", async () => {
    vi.mocked(shared.deleteStickerPack).mockRejectedValue(new Error("500"));
    renderMine();

    fireEvent.click(await screen.findByRole("button", { name: "Delete pack" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(shared.showToast).toHaveBeenCalledWith("error", "Failed to delete, please retry"),
    );
    expect(await screen.findByText("我的包")).toBeInTheDocument();
  });

  it("shows the empty state with a shortcut to the publish page", async () => {
    vi.mocked(shared.listMyPacks).mockResolvedValue([]);
    renderMine();

    expect(await screen.findByText(/you have not published any packs yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    expect(await screen.findByText("publish-probe")).toBeInTheDocument();
  });
});
