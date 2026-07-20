import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MessageImage } from "../MessageImage";

// getDownloadUrl 由 files api 提供：桩掉以避免真实 fetch，断言 key→url 换取路径
const getDownloadUrl = vi.fn(async (key: string) => "https://signed/" + key);
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, getDownloadUrl: (k: string) => getDownloadUrl(k) };
});

describe("MessageImage", () => {
  beforeEach(() => {
    getDownloadUrl.mockClear();
  });

  it("renders localUrl directly without signing a download url", () => {
    render(<MessageImage image={{ width: 800, height: 600, localUrl: "blob:local" }} />);
    const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:local");
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("caps display box to a 280px longest edge, preserving aspect ratio", () => {
    render(<MessageImage image={{ width: 2560, height: 1280, localUrl: "blob:local" }} />);
    const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
    // 2560 → 280 缩放 (×0.109375)：宽 280、高 140
    expect(img.getAttribute("width")).toBe("280");
    expect(img.getAttribute("height")).toBe("140");
  });

  it("fetches a download url by key when no localUrl", async () => {
    render(<MessageImage image={{ width: 100, height: 100, key: "images/a.png" }} />);
    await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledWith("images/a.png"));
    const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://signed/images/a.png");
  });

  it("calls onOpen with the current url when the image is clicked", () => {
    const onOpen = vi.fn();
    render(
      <MessageImage image={{ width: 100, height: 100, localUrl: "blob:local" }} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("img", { name: "Image" }));
    expect(onOpen).toHaveBeenCalledWith("blob:local");
  });

  it("shows a retry affordance when the image fails to load", () => {
    render(<MessageImage image={{ width: 100, height: 100, localUrl: "blob:local" }} />);
    fireEvent.error(screen.getByRole("img", { name: "Image" }));
    // 失败态：整块变成可点击重试按钮
    expect(screen.getByRole("button", { name: /Failed to load image/i })).toBeInTheDocument();
  });
});
