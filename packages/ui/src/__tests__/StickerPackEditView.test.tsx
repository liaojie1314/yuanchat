/**
 * StickerPackEditView 编辑页测试
 *
 * 覆盖核心交互：改名保存（仅变更后可提交）、从包移除贴纸、
 * 非发布者直链给无权提示。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StickerPackEditView } from "../stickers/StickerPackEditView";
import * as shared from "@yuanchat/shared";
import type { PackDetail, StickerItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    getPackDetail: vi.fn(),
    listMyStickers: vi.fn(),
    updateStickerPack: vi.fn(),
    addStickerToPack: vi.fn(),
    removeStickerFromPack: vi.fn(),
    // 原收藏删除接口：编辑页不应误用（移除包内贴纸 ≠ 删除收藏）
    removeSticker: vi.fn(),
    showToast: vi.fn(),
  };
});

const DETAIL: PackDetail = {
  pack: {
    id: "p1",
    name: "旧名",
    cover_url: null,
    is_official: false,
    owner_name: "E2E",
    is_owner: true,
    sticker_count: 1,
    created_at: "2026-08-30T10:00:00Z",
  },
  stickers: [{ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 }],
  added: true,
};

const FAVS: StickerItem[] = [
  { id: "s9", object_key: "images/2026/08/z.png", width: 96, height: 96 },
];

function renderEdit(packId = "p1") {
  return render(
    <MemoryRouter initialEntries={["/stickers/" + packId + "/edit"]}>
      <Routes>
        <Route path="/stickers/:packId/edit" element={<StickerPackEditView packId={packId} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StickerPackEditView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPackDetail).mockResolvedValue(DETAIL);
    vi.mocked(shared.listMyStickers).mockResolvedValue(FAVS);
    vi.mocked(shared.updateStickerPack).mockResolvedValue(DETAIL);
    vi.mocked(shared.removeStickerFromPack).mockResolvedValue(undefined);
    vi.mocked(shared.addStickerToPack).mockResolvedValue(undefined);
  });

  it("saves the renamed pack with only the changed field", async () => {
    renderEdit();

    const input = await screen.findByLabelText("Pack name");
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(shared.updateStickerPack).toHaveBeenCalledWith("p1", { name: "新名字" }),
    );
    expect(shared.showToast).toHaveBeenCalledWith("info", "Saved");
  });

  it("disables saving until the name actually changes", async () => {
    renderEdit();

    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(await screen.findByLabelText("Pack name"), { target: { value: "旧名" } });
    expect(save).toBeDisabled(); // 与原名相同也不可提交
  });

  it("removes a sticker from the pack without touching the original favorite", async () => {
    renderEdit();

    fireEvent.click(await screen.findByRole("button", { name: "Remove from pack" }));

    await waitFor(() => expect(shared.removeStickerFromPack).toHaveBeenCalledWith("p1", "s1"));
    // 包内贴纸摘除后网格为空，展示空包提示
    expect(await screen.findByText(/no stickers in this pack yet/i)).toBeInTheDocument();
    expect(shared.removeSticker).not.toHaveBeenCalled();
  });

  it("appends a favorite sticker to the pack via the collection source", async () => {
    renderEdit();

    // 收藏网格里的 s9 可选（排除表按 object_key 匹配包内 s1，mock 收藏里没有它）
    const buttons = await screen.findAllByRole("button", { name: "Add to Stickers" });
    fireEvent.click(buttons[0]);

    await waitFor(() =>
      expect(shared.addStickerToPack).toHaveBeenCalledWith("p1", {
        source: "collection",
        sticker_id: "s9",
      }),
    );
    // 追加成功后必须回读详情：包内行是服务端新复制的行（新 id 与收藏不同），
    // 不回读的话网格里是收藏 id 的占位行，后续「从包移除」会拿错误 id 恒 404
    await waitFor(() => expect(shared.getPackDetail).toHaveBeenCalledTimes(2));
  });

  it("replaces the pack grid with the reconciled server detail after appending", async () => {
    // 回读返回的是服务端真身：包内出现的是复制行 s9x（新 id、同 object_key）
    vi.mocked(shared.getPackDetail)
      .mockResolvedValueOnce(DETAIL)
      .mockResolvedValue({
        ...DETAIL,
        stickers: [
          ...DETAIL.stickers,
          { id: "s9x", object_key: "images/2026/08/z.png", width: 96, height: 96 },
        ],
        pack: { ...DETAIL.pack, sticker_count: 2 },
      });
    renderEdit();

    fireEvent.click((await screen.findAllByRole("button", { name: "Add to Stickers" }))[0]);
    await waitFor(() => expect(shared.getPackDetail).toHaveBeenCalledTimes(2));

    // 网格按服务端真身渲染（s1 + s9x）：移除按钮携带的是包内行的 id（s9x），
    // 不是收藏 id
    const removes = await screen.findAllByRole("button", { name: "Remove from pack" });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[1]);
    await waitFor(() => expect(shared.removeStickerFromPack).toHaveBeenCalledWith("p1", "s9x"));
  });

  it("disables favorites whose object_key is already in the pack", async () => {
    // s-copy 与包内 s1 同内容（复制行 object_key 相同、id 不同）→ 按键排除
    vi.mocked(shared.listMyStickers).mockResolvedValue([
      { id: "s9", object_key: "images/2026/08/z.png", width: 96, height: 96 },
      { id: "s-copy", object_key: "images/2026/08/a.png", width: 96, height: 96 },
    ]);
    renderEdit();

    const buttons = await screen.findAllByRole("button", { name: "Add to Stickers" });
    expect(buttons).toHaveLength(2);
    const disabled = buttons.filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabled).toHaveLength(1);
  });

  it("shows a not-owner notice when the viewer is not the publisher", async () => {
    vi.mocked(shared.getPackDetail).mockResolvedValue({
      ...DETAIL,
      pack: { ...DETAIL.pack, is_owner: false },
    });
    renderEdit();

    expect(await screen.findByText(/only the owner can edit/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Pack name")).not.toBeInTheDocument();
  });
});
