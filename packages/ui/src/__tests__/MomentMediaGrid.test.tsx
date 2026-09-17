/**
 * MomentMediaGrid 布局测试：图数决定列数，视频走单卡
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MomentMediaGrid } from "../moments/MomentMediaGrid";
import type { MomentMediaItem } from "@yuanchat/shared";

// 下载签名走网络，测试里桩掉
vi.mock("@yuanchat/shared", async () => {
  const actual = await vi.importActual<typeof import("@yuanchat/shared")>("@yuanchat/shared");
  return { ...actual, getDownloadUrl: vi.fn(async (key: string) => "blob:" + key) };
});

function items(n: number): MomentMediaItem[] {
  return Array.from({ length: n }, (_, i) => ({ key: `images/${i}.jpg`, w: 100, h: 100 }));
}

describe("MomentMediaGrid", () => {
  it("单图不进网格，按原始宽高比渲染", () => {
    const { container } = render(<MomentMediaGrid media={items(1)} mediaKind={1} />);
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(1);
    expect(container.querySelector("[data-grid-cols]")?.getAttribute("data-grid-cols")).toBe("1");
  });

  it("四图走 2×2", () => {
    const { container } = render(<MomentMediaGrid media={items(4)} mediaKind={1} />);
    expect(container.querySelector("[data-grid-cols]")?.getAttribute("data-grid-cols")).toBe("2");
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(4);
  });

  it("三图单行等分", () => {
    const { container } = render(<MomentMediaGrid media={items(3)} mediaKind={1} />);
    expect(container.querySelector("[data-grid-cols]")?.getAttribute("data-grid-cols")).toBe("3");
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(3);
  });

  it("九图走三列", () => {
    const { container } = render(<MomentMediaGrid media={items(9)} mediaKind={1} />);
    expect(container.querySelector("[data-grid-cols]")?.getAttribute("data-grid-cols")).toBe("3");
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(9);
  });

  it("视频渲染单卡与播放角标", () => {
    render(
      <MomentMediaGrid
        media={[{ key: "files/a.mp4", thumbKey: "images/a.jpg", duration: 12, w: 1280, h: 720 }]}
        mediaKind={2}
      />,
    );
    expect(screen.getByTestId("moment-video-card")).toBeInTheDocument();
  });

  it("无媒体渲染空", () => {
    const { container } = render(<MomentMediaGrid media={[]} mediaKind={0} />);
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(0);
  });
});
