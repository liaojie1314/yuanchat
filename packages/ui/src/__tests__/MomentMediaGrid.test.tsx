/**
 * MomentMediaGrid 布局测试：图数决定列数，视频走单卡
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("点九宫格里的图开的是整帖图集，页码定位到点的那张", async () => {
    const { container } = render(<MomentMediaGrid media={items(9)} mediaKind={1} />);
    const cells = container.querySelectorAll("[data-media-cell]");

    // 签名落地后格子才可点（未就绪时 disabled，避免开出空白层）
    await waitFor(() => expect((cells[2] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(cells[2]);

    expect((await screen.findByTestId("lightbox-counter")).textContent).toBe("3/9");
  });

  it("单图点开不出翻页按钮", async () => {
    const { container } = render(<MomentMediaGrid media={items(1)} mediaKind={1} />);
    const cell = container.querySelector("[data-media-cell]") as HTMLButtonElement;

    await waitFor(() => expect(cell.disabled).toBe(false));
    fireEvent.click(cell);

    await screen.findByRole("dialog");
    expect(screen.queryByTestId("lightbox-counter")).toBeNull();
  });

  it("无媒体渲染空", () => {
    const { container } = render(<MomentMediaGrid media={[]} mediaKind={0} />);
    expect(container.querySelectorAll("[data-media-cell]")).toHaveLength(0);
  });
});
