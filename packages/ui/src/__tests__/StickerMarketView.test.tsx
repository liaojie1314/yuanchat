/**
 * StickerMarketView 商城列表页测试
 *
 * 覆盖核心交互：卡片渲染（名称/发布者/贴纸数/已添加角标）、骨架屏加载态、
 * 空态、错误态+重试、游标翻页（加载更多）、卡片与页头入口的路由跳转。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StickerMarketView } from "../stickers/StickerMarketView";
import * as shared from "@yuanchat/shared";
import type { MarketPackItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    listMarketPacks: vi.fn(),
    showToast: vi.fn(),
  };
});

/** 构造一个商城列表项（可覆盖字段） */
function pack(overrides: Partial<MarketPackItem> = {}): MarketPackItem {
  return {
    id: "p1",
    name: "小黄脸",
    cover_url: null,
    owner_name: "Ming",
    is_official: false,
    sticker_count: 8,
    created_at: "2026-08-20T10:00:00Z",
    added: false,
    ...overrides,
  };
}

/** 渲染商城页（带路由探针：跳转后渲染占位文本，用于断言导航目标） */
function renderMarket() {
  return render(
    <MemoryRouter initialEntries={["/stickers"]}>
      <Routes>
        <Route path="/stickers" element={<StickerMarketView />} />
        <Route path="/stickers/:packId" element={<div>pack-detail-probe</div>} />
        <Route path="/stickers/publish" element={<div>publish-probe</div>} />
        <Route path="/stickers/mine" element={<div>mine-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StickerMarketView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pack cards with publisher, count and added badge", async () => {
    vi.mocked(shared.listMarketPacks).mockResolvedValue({
      packs: [
        pack(),
        pack({
          id: "p2",
          name: "官方包",
          owner_name: null,
          is_official: true,
          sticker_count: 6,
          added: true,
        }),
      ],
      nextCursor: null,
    });

    renderMarket();

    expect(await screen.findByText("小黄脸")).toBeInTheDocument();
    expect(screen.getByText("by Ming")).toBeInTheDocument();
    // 贴纸数渲染为封面左下角的计数胶囊（仅数字，防止单行文案截断丢信息）
    expect(screen.getByText("8")).toBeInTheDocument();
    // owner_name 为 null 的官方包走官方文案，且已添加角标可见
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(shared.listMarketPacks).toHaveBeenCalledWith({ limit: 20 });
  });

  it("shows a fixed-size skeleton grid while the first page loads", async () => {
    vi.mocked(shared.listMarketPacks).mockReturnValue(new Promise(() => {}));

    renderMarket();

    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("小黄脸")).not.toBeInTheDocument();
  });

  it("shows the empty state when the market has no packs", async () => {
    vi.mocked(shared.listMarketPacks).mockResolvedValue({ packs: [], nextCursor: null });

    renderMarket();

    expect(await screen.findByText(/no sticker packs yet/i)).toBeInTheDocument();
  });

  it("shows an error state with retry and reloads on retry", async () => {
    vi.mocked(shared.listMarketPacks).mockRejectedValueOnce(new Error("500"));

    renderMarket();
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();

    vi.mocked(shared.listMarketPacks).mockResolvedValue({ packs: [pack()], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("小黄脸")).toBeInTheDocument();
    expect(shared.listMarketPacks).toHaveBeenCalledTimes(2);
  });

  it("appends the next page when clicking load more", async () => {
    vi.mocked(shared.listMarketPacks)
      .mockResolvedValueOnce({ packs: [pack({ id: "p1" })], nextCursor: "2026-08-19T00:00:00Z" })
      .mockResolvedValueOnce({ packs: [pack({ id: "p2", name: "第二页" })], nextCursor: null });

    renderMarket();
    const loadMore = await screen.findByRole("button", { name: "Load more" });
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText("第二页")).toBeInTheDocument());
    expect(screen.getByText("小黄脸")).toBeInTheDocument();
    // 没有下一页后按钮消失
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(shared.listMarketPacks).toHaveBeenLastCalledWith({
      cursor: "2026-08-19T00:00:00Z",
      limit: 20,
    });
  });

  it("navigates to the pack detail when a card is clicked", async () => {
    vi.mocked(shared.listMarketPacks).mockResolvedValue({
      packs: [pack({ id: "abc" })],
      nextCursor: null,
    });

    renderMarket();
    fireEvent.click(await screen.findByText("小黄脸"));

    expect(await screen.findByText("pack-detail-probe")).toBeInTheDocument();
  });

  it("navigates to publish and mine pages from the header", async () => {
    vi.mocked(shared.listMarketPacks).mockResolvedValue({ packs: [pack()], nextCursor: null });

    renderMarket();
    fireEvent.click(await screen.findByRole("button", { name: "Create Pack" }));
    expect(await screen.findByText("publish-probe")).toBeInTheDocument();

    renderMarket();
    fireEvent.click(await screen.findByRole("button", { name: "My Packs" }));
    expect(await screen.findByText("mine-probe")).toBeInTheDocument();
  });
});
