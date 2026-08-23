/**
 * EmojiPicker 贴纸 tab 测试
 *
 * 覆盖：tab 条件渲染、选中贴纸回调、以及三条**失败可见**路径——
 * 列表拉取失败要给错误态 + 可重试（而非空白面板）、拉取成功但为空要给空态文案、
 * 删除失败要回滚本地并提示（而非静默留着贴纸）。
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmojiPicker } from "../EmojiPicker";
import * as shared from "@yuanchat/shared";

const FAV = [{ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 }];
const PACKS = [
  {
    pack: { id: "p1", name: "默认表情", is_official: true, sort: 0 },
    stickers: [{ id: "s2", object_key: "images/2026/08/b.png", width: 96, height: 96 }],
  },
];

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    listMyStickers: vi.fn(),
    listStickerPacks: vi.fn(),
    removeSticker: vi.fn(),
    getDownloadUrl: vi.fn(),
    showToast: vi.fn(),
  };
});

/** 渲染并切到指定 tab（tab 文案为 en-US） */
async function openTab(name: "Favorites" | "Official") {
  render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} onPickSticker={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name }));
}

describe("EmojiPicker sticker tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listMyStickers).mockResolvedValue(FAV);
    vi.mocked(shared.listStickerPacks).mockResolvedValue(PACKS);
    vi.mocked(shared.removeSticker).mockResolvedValue(undefined);
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/x.png");
  });

  it("renders Favorites and Official tabs only when onPickSticker is provided", async () => {
    const { unmount } = render(
      <EmojiPicker onPick={vi.fn()} onClose={vi.fn()} onPickSticker={vi.fn()} />,
    );
    expect(await screen.findByRole("tab", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Official" })).toBeInTheDocument();
    unmount();

    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Favorites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Official" })).not.toBeInTheDocument();
  });

  it("calls onPickSticker with the mapped payload when a sticker is clicked", async () => {
    const onPickSticker = vi.fn();
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} onPickSticker={onPickSticker} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Favorites" }));

    fireEvent.click(await screen.findByRole("button", { name: "Send sticker" }));

    expect(onPickSticker).toHaveBeenCalledWith({
      id: "s1",
      objectKey: "images/2026/08/a.png",
      width: 96,
      height: 96,
    });
  });

  it("shows an error state with retry when the favorites request fails", async () => {
    vi.mocked(shared.listMyStickers).mockRejectedValueOnce(new Error("500"));
    await openTab("Favorites");

    // 失败必须可见：不能退化成一个与「我没有收藏」无法区分的空白面板
    expect(await screen.findByText("Failed to load stickers")).toBeInTheDocument();

    vi.mocked(shared.listMyStickers).mockResolvedValue(FAV);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Send sticker" })).toBeInTheDocument();
    expect(shared.listMyStickers).toHaveBeenCalledTimes(2);
  });

  it("distinguishes an empty favorites list from a failed one", async () => {
    vi.mocked(shared.listMyStickers).mockResolvedValue([]);
    await openTab("Favorites");

    expect(await screen.findByText(/No saved stickers yet/i, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Failed to load stickers")).not.toBeInTheDocument();
  });

  it("shows an empty state for the official tab when no packs are seeded", async () => {
    vi.mocked(shared.listStickerPacks).mockResolvedValue([]);
    await openTab("Official");

    expect(await screen.findByText("No official stickers")).toBeInTheDocument();
  });

  it("removes a favorite sticker locally on success", async () => {
    await openTab("Favorites");
    const sticker = await screen.findByRole("button", { name: "Send sticker" });

    fireEvent.contextMenu(sticker);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/i }));

    await waitFor(() => expect(shared.removeSticker).toHaveBeenCalledWith("s1"));
    expect(screen.queryByRole("button", { name: "Send sticker" })).not.toBeInTheDocument();
  });

  it("restores the sticker and toasts when removal fails", async () => {
    vi.mocked(shared.removeSticker).mockRejectedValue(new Error("403"));
    await openTab("Favorites");
    const sticker = await screen.findByRole("button", { name: "Send sticker" });

    fireEvent.contextMenu(sticker);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/i }));

    // 乐观删除后失败：贴纸必须回到列表，并且用户得到提示（原实现是静默消失/静默留着）
    await waitFor(() =>
      expect(shared.showToast).toHaveBeenCalledWith("error", "Failed to delete, please retry"),
    );
    expect(await screen.findByRole("button", { name: "Send sticker" })).toBeInTheDocument();
  });

  it("does not offer deletion for official stickers", async () => {
    await openTab("Official");
    const sticker = await screen.findByRole("button", { name: "Send sticker" });

    fireEvent.contextMenu(sticker);

    expect(screen.queryByRole("menuitem", { name: /Delete/i })).not.toBeInTheDocument();
  });
});
