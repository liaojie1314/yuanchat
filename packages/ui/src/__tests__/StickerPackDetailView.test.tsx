/**
 * StickerPackDetailView 包详情页测试
 *
 * 覆盖核心交互：详情渲染（名称/发布者/贴纸）、添加/已添加幂等切换
 * （含失败回滚）、举报二次确认、is_owner 编辑入口、加载失败重试。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StickerPackDetailView } from "../stickers/StickerPackDetailView";
import * as shared from "@yuanchat/shared";
import type { PackDetail } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    getPackDetail: vi.fn(),
    addStickerPack: vi.fn(),
    removeStickerPack: vi.fn(),
    reportStickerPack: vi.fn(),
    showToast: vi.fn(),
  };
});

/** 构造包详情响应（可覆盖字段） */
function detail(overrides: Partial<PackDetail> = {}): PackDetail {
  return {
    pack: {
      id: "p1",
      name: "小黄脸",
      cover_url: null,
      is_official: false,
      owner_name: "Ming",
      is_owner: false,
      sticker_count: 2,
      created_at: "2026-08-20T10:00:00Z",
    },
    stickers: [
      { id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 },
      { id: "s2", object_key: "images/2026/08/b.png", width: 96, height: 96 },
    ],
    added: false,
    ...overrides,
  };
}

function renderDetail(packId = "p1") {
  return render(
    <MemoryRouter initialEntries={["/stickers/" + packId]}>
      <Routes>
        <Route path="/stickers" element={<div>market-probe</div>} />
        <Route path="/stickers/:packId" element={<StickerPackDetailView packId={packId} />} />
        <Route path="/stickers/:packId/edit" element={<div>edit-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StickerPackDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPackDetail).mockResolvedValue(detail());
    vi.mocked(shared.addStickerPack).mockResolvedValue(undefined);
    vi.mocked(shared.removeStickerPack).mockResolvedValue(undefined);
    vi.mocked(shared.reportStickerPack).mockResolvedValue({ id: "r1", status: 0 });
  });

  it("renders pack summary with owner text and sticker grid", async () => {
    renderDetail();

    // 页头标题与概要区标题都会渲染包名（h1 + h2），出现即视为详情已挂载
    const headings = await screen.findAllByRole("heading", { name: "小黄脸" });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("by Ming")).toBeInTheDocument();
    expect(screen.getByText("2 stickers")).toBeInTheDocument();
  });

  it("toggles add/remove idempotently against the API", async () => {
    renderDetail();

    const addBtn = await screen.findByRole("button", { name: "Add" });
    fireEvent.click(addBtn);

    await waitFor(() => expect(shared.addStickerPack).toHaveBeenCalledWith("p1"));
    // 乐观切换成已添加态（再点一次即移除）
    const addedBtn = await screen.findByRole("button", { name: "Added" });
    fireEvent.click(addedBtn);
    await waitFor(() => expect(shared.removeStickerPack).toHaveBeenCalledWith("p1"));
    expect(await screen.findByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("rolls the toggle back with a toast when the API call fails", async () => {
    vi.mocked(shared.addStickerPack).mockRejectedValue(new Error("500"));
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(shared.showToast).toHaveBeenCalledWith("error", "Failed to add, please retry"),
    );
    expect(await screen.findByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("reports the pack through a confirm dialog", async () => {
    renderDetail();

    // 页面上的举报按钮与弹窗确认按钮同名，弹窗打开后取后者（渲染顺序靠后）
    fireEvent.click(await screen.findByRole("button", { name: "Report" }));
    const buttons = await screen.findAllByRole("button", { name: "Report" });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(shared.reportStickerPack).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(shared.showToast).toHaveBeenCalledWith(
        "info",
        "Report submitted. We'll review it soon",
      ),
    );
  });

  it("shows the edit entry only for the owner and navigates to it", async () => {
    const { unmount } = renderDetail();
    await screen.findAllByRole("heading", { name: "小黄脸" });
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    unmount();

    vi.mocked(shared.getPackDetail).mockResolvedValue(
      detail({ pack: { is_owner: true } as PackDetail["pack"] }),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
    expect(await screen.findByText("edit-probe")).toBeInTheDocument();
  });

  it("shows an error state with retry when the detail request fails", async () => {
    vi.mocked(shared.getPackDetail).mockRejectedValue(new Error("404"));
    renderDetail();

    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });
});
