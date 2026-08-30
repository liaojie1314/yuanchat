/**
 * StickerPublishView 发布页测试
 *
 * 覆盖核心交互：表单校验（缺名称/缺贴纸就地报错）、收藏多选后提交
 * （collection 来源 + 默认第一张为封面源）、发布上限专属文案、
 * 收藏拉取失败的重试入口。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StickerPublishView } from "../StickerPublishView";
import * as shared from "@yuanchat/shared";
import type { PackDetail, StickerItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    listMyStickers: vi.fn(),
    publishStickerPack: vi.fn(),
    getDownloadUrl: vi.fn(),
    getUploadUrl: vi.fn(),
    uploadToTicket: vi.fn(),
    showToast: vi.fn(),
    captureException: vi.fn(),
  };
});

const FAVS: StickerItem[] = [
  { id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 },
  { id: "s2", object_key: "images/2026/08/b.png", width: 96, height: 96 },
];

const DETAIL: PackDetail = {
  pack: {
    id: "np1",
    name: "新包",
    cover_url: null,
    is_official: false,
    owner_name: "E2E",
    is_owner: true,
    sticker_count: 1,
    created_at: "2026-08-30T10:00:00Z",
  },
  stickers: [],
  added: false,
};

function renderPublish() {
  return render(
    <MemoryRouter initialEntries={["/stickers/publish"]}>
      <Routes>
        <Route path="/stickers/publish" element={<StickerPublishView />} />
        <Route path="/stickers/:packId" element={<div>detail-probe</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StickerPublishView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listMyStickers).mockResolvedValue(FAVS);
    vi.mocked(shared.publishStickerPack).mockResolvedValue(DETAIL);
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("data:image/png;base64,QQ==");
    vi.mocked(shared.getUploadUrl).mockResolvedValue({
      uploadUrl: "http://mock/put",
      objectKey: "sticker-covers/2026/08/x.png",
      publicUrl: "http://mock/public/x.png",
    });
    vi.mocked(shared.uploadToTicket).mockResolvedValue(undefined);
  });

  it("shows inline validation errors for missing name and stickers", async () => {
    renderPublish();
    const submit = await screen.findByRole("button", { name: "Publish" });

    fireEvent.click(submit);
    expect(await screen.findByText("Please enter a pack name")).toBeInTheDocument();
    expect(shared.publishStickerPack).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Pack name"), { target: { value: "新包" } });
    fireEvent.click(submit);
    expect(await screen.findByText("Pick at least one sticker")).toBeInTheDocument();
    expect(shared.publishStickerPack).not.toHaveBeenCalled();
  });

  it("submits collection sources with the default first cover and navigates to the new pack", async () => {
    renderPublish();

    // 等收藏网格渲染（贴纸按钮以 aria-label 区分）
    const buttons = await screen.findAllByRole("button", { name: "Add to Stickers" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    fireEvent.change(screen.getByLabelText("Pack name"), { target: { value: "  新包  " } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(shared.publishStickerPack).toHaveBeenCalledTimes(1));
    const input = vi.mocked(shared.publishStickerPack).mock.calls[0][0];
    expect(input.name).toBe("新包"); // trim 生效
    expect(input.sticker_sources).toEqual([
      { source: "collection", sticker_id: "s1" },
      { source: "collection", sticker_id: "s2" },
    ]);
    // 默认封面取第一张勾选贴纸：封面经 sticker-covers 通道复制上传
    expect(input.cover_object_key).toBe("sticker-covers/2026/08/x.png");
    expect(input.cover_width).toBe(96);
    expect(await screen.findByText("detail-probe")).toBeInTheDocument();
    expect(shared.showToast).toHaveBeenCalledWith("info", "Published");
  });

  it("maps the publish-limit error to its dedicated message", async () => {
    vi.mocked(shared.publishStickerPack).mockRejectedValue(
      new shared.ApiError(400, "publish limit exceeded"),
    );
    renderPublish();

    const buttons = await screen.findAllByRole("button", { name: "Add to Stickers" });
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByLabelText("Pack name"), { target: { value: "新包" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(shared.showToast).toHaveBeenCalledWith(
        "error",
        "You have reached the publish limit (20 packs)",
      ),
    );
  });

  it("shows a retry entry when loading the favorites fails", async () => {
    vi.mocked(shared.listMyStickers).mockRejectedValue(new Error("500"));
    renderPublish();

    expect(await screen.findByText("Failed to load stickers")).toBeInTheDocument();

    vi.mocked(shared.listMyStickers).mockResolvedValue(FAVS);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByRole("button", { name: "Add to Stickers" })).toHaveLength(2);
  });
});
