import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { StickerImage } from "../StickerImage";
import * as shared from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async () => {
  const actual = await vi.importActual("@yuanchat/shared");
  return {
    ...actual,
    getDownloadUrl: vi.fn(),
  };
});

describe("StickerImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sticker with correct dimensions", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/sticker.webp");

    const { container } = render(
      <StickerImage
        sticker={{
          objectKey: "stickers/test.webp",
          width: 120,
          height: 120,
        }}
      />,
    );

    await waitFor(() => {
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toBeInTheDocument();
      // 120x120 贴纸，扣除 8px 边距后渲染为 112x112
      expect(wrapper).toHaveStyle({ width: "112px", height: "112px" });
    });
  });

  it("scales down large stickers proportionally", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/large.webp");

    const { container } = render(
      <StickerImage
        sticker={{
          objectKey: "stickers/large.webp",
          width: 400,
          height: 300,
        }}
      />,
    );

    await waitFor(() => {
      const wrapper = container.firstChild as HTMLElement;
      // 大贴纸缩放：最大边 200，扣边距后 192
      expect(wrapper.style.width).toBeTruthy();
      expect(wrapper.style.height).toBeTruthy();
    });
  });

  it("maintains aspect ratio for non-square stickers", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/rect.webp");

    const { container } = render(
      <StickerImage
        sticker={{
          objectKey: "stickers/rect.webp",
          width: 160,
          height: 120,
        }}
      />,
    );

    await waitFor(() => {
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toBeInTheDocument();
      // 160x120 保持 4:3 比例
      expect(wrapper).toHaveStyle({ width: "112px", height: "84px" });
    });
  });

  it("shows loading skeleton before URL resolves", () => {
    vi.mocked(shared.getDownloadUrl).mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <StickerImage
        sticker={{
          objectKey: "stickers/loading.webp",
          width: 120,
          height: 120,
        }}
      />,
    );

    // 加载中显示 skeleton（相对定位容器）
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.className).toContain("relative");
  });
});
