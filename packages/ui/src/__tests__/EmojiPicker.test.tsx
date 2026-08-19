import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmojiPicker } from "../EmojiPicker";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    listMyStickers: vi.fn(async () => [
      { id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 },
    ]),
    listStickerPacks: vi.fn(async () => [
      {
        pack: { id: "p1", name: "默认表情", is_official: true, sort: 0 },
        stickers: [{ id: "s2", object_key: "images/2026/08/b.png", width: 96, height: 96 }],
      },
    ]),
    removeSticker: vi.fn(async () => {}),
    getDownloadUrl: vi.fn(async (key: string) => `https://example.com/${key}`),
  };
});

describe("EmojiPicker sticker tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Favorites and Official tabs when onPickSticker is provided", async () => {
    const onPickSticker = vi.fn();
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} onPickSticker={onPickSticker} />);
    await waitFor(() => {
      expect(screen.getByText("Favorites")).toBeInTheDocument();
      expect(screen.getByText("Official")).toBeInTheDocument();
    });
  });

  it("does not render sticker tabs when onPickSticker is undefined", () => {
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    expect(screen.queryByText("Official")).not.toBeInTheDocument();
  });

  it("calls onPickSticker when a sticker is clicked", async () => {
    const onPickSticker = vi.fn();
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} onPickSticker={onPickSticker} />);

    const favTab = await screen.findByText("Favorites");
    fireEvent.click(favTab);

    await waitFor(() => {
      const stickerButtons = screen.getAllByRole("button");
      const stickerBtn = stickerButtons.find((btn) => btn.className.includes("aspect-square"));
      if (stickerBtn) fireEvent.click(stickerBtn);
    });

    await waitFor(() => {
      expect(onPickSticker).toHaveBeenCalledWith({
        id: "s1",
        objectKey: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
    });
  });
});
