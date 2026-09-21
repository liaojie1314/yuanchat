import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MessageImage } from "../chat/MessageImage";

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

  describe("lazy loading (IntersectionObserver available)", () => {
    let observed: Element[];
    let trigger: (isIntersecting: boolean) => void;

    beforeEach(() => {
      observed = [];
      let cb: IntersectionObserverCallback;
      trigger = (isIntersecting) => {
        act(() => {
          cb(
            observed.map((el) => ({ isIntersecting, target: el })) as IntersectionObserverEntry[],
            {} as IntersectionObserver,
          );
        });
      };
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            cb = callback;
          }
          observe(el: Element) {
            observed.push(el);
          }
          disconnect() {}
          unobserve() {}
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("does not presign until the image scrolls into view", async () => {
      render(<MessageImage image={{ width: 100, height: 100, key: "images/lazy.png" }} />);
      expect(observed.length).toBe(1);
      // 未进视口：不发 presign
      expect(getDownloadUrl).not.toHaveBeenCalled();

      // 进入视口后才签名
      trigger(true);
      await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledWith("images/lazy.png"));
    });

    it("keeps the aspect-ratio skeleton box before visibility (no CLS)", () => {
      const { container } = render(
        <MessageImage image={{ width: 800, height: 400, key: "images/skel.png" }} />,
      );
      const boxEl = container.firstElementChild as HTMLElement;
      // 骨架盒与最终图片同尺寸（280×140），布局不因加载而跳动
      expect(boxEl.style.width).toBe("280px");
      expect(boxEl.style.height).toBe("140px");
    });

    it("localUrl (optimistic send) renders immediately without waiting for viewport", () => {
      render(<MessageImage image={{ width: 100, height: 100, localUrl: "blob:opt" }} />);
      const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("blob:opt");
      expect(getDownloadUrl).not.toHaveBeenCalled();
    });
  });
});
