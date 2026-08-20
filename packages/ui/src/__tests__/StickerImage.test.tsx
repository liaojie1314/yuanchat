/**
 * StickerImage 单元测试
 *
 * 覆盖：
 * - 按 sticker.key 签下载 URL 并渲染 <img>（prop 名是 key，与 ChatMessage.sticker 一致）
 * - 展示盒尺寸：最长边上限 112px，不放大小图，等比缩放保持宽高比
 * - 签名未返回/失败时只留占位盒，不渲染 <img> 也不抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("signs the object key and renders the image", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/sticker.png");

    render(<StickerImage sticker={{ key: "images/2026/08/a.png", width: 96, height: 96 }} />);

    expect(shared.getDownloadUrl).toHaveBeenCalledWith("images/2026/08/a.png");
    const img = await screen.findByRole("presentation");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/sticker.png");
  });

  it("keeps a sticker smaller than the cap at its native size", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/small.png");

    const { container } = render(
      <StickerImage sticker={{ key: "images/small.png", width: 64, height: 64 }} />,
    );

    // 不放大小图：64 < 112 上限，原样展示
    expect(container.firstChild).toHaveStyle({ width: "64px", height: "64px" });
  });

  it("scales a large sticker down to the 112px cap on its longest edge", async () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/large.png");

    const { container } = render(
      <StickerImage sticker={{ key: "images/large.png", width: 400, height: 300 }} />,
    );

    // 最长边 400 → 112，短边等比 300 * (112/400) = 84
    expect(container.firstChild).toHaveStyle({ width: "112px", height: "84px" });
  });

  it("falls back to a square box when dimensions are missing", () => {
    vi.mocked(shared.getDownloadUrl).mockResolvedValue("https://cdn.example.com/x.png");

    const { container } = render(
      <StickerImage sticker={{ key: "images/x.png", width: 0, height: 0 }} />,
    );

    expect(container.firstChild).toHaveStyle({ width: "112px", height: "112px" });
  });

  it("renders only the placeholder box when signing fails", async () => {
    vi.mocked(shared.getDownloadUrl).mockRejectedValue(new Error("sign failed"));

    const { container } = render(
      <StickerImage sticker={{ key: "images/broken.png", width: 96, height: 96 }} />,
    );

    await waitFor(() => expect(shared.getDownloadUrl).toHaveBeenCalled());
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstChild).toHaveStyle({ width: "96px", height: "96px" });
  });

  it("does not sign anything when the key is absent", () => {
    const { container } = render(<StickerImage sticker={{ width: 96, height: 96 }} />);

    expect(shared.getDownloadUrl).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });
});
