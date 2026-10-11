import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { runBackInterceptors } from "@yuanchat/shared";
import { ImageLightbox } from "../chat/ImageLightbox";

// jsdom 默认 locale en-US，aria-label 文案断言用英文
describe("ImageLightbox", () => {
  it("renders the image at the given url", () => {
    render(<ImageLightbox urls={["blob:x"]} onClose={() => {}} />);
    const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:x");
  });

  it("closes on overlay click", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={["blob:x"]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={["blob:x"]} onClose={onClose} />);
    // 关闭按钮点击会同时命中按钮自身与冒泡到遮罩的 onClose（"点击任意处关闭"设计），
    // 父层 setLightboxUrl(null) 幂等，多次调用无害——只断言确实触发了关闭
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={["blob:x"]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores body overflow on unmount", () => {
    const { unmount } = render(<ImageLightbox urls={["blob:x"]} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("单图不渲染左右切换与页码", () => {
    render(<ImageLightbox urls={["blob:x"]} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Previous image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
    expect(screen.queryByTestId("lightbox-counter")).toBeNull();
  });

  it("多图显示页码，点下一张切图且不触发关闭", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={["blob:a", "blob:b", "blob:c"]} index={1} onClose={onClose} />);

    expect(screen.getByTestId("lightbox-counter").textContent).toBe("2/3");
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(screen.getByTestId("lightbox-counter").textContent).toBe("3/3");
    expect(screen.getByRole("img", { name: "Image" }).getAttribute("src")).toBe("blob:c");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("首尾不循环：到头的方向键禁用", () => {
    render(<ImageLightbox urls={["blob:a", "blob:b"]} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next image" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("button", { name: "Previous image" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next image" })).toBeDisabled();
  });

  it("键盘左右方向键切图，到头不绕回", () => {
    render(<ImageLightbox urls={["blob:a", "blob:b"]} onClose={() => {}} />);

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByTestId("lightbox-counter").textContent).toBe("1/2");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByTestId("lightbox-counter").textContent).toBe("2/2");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByTestId("lightbox-counter").textContent).toBe("2/2");
  });

  it("index 越界时退到第一张", () => {
    render(<ImageLightbox urls={["blob:a", "blob:b"]} index={9} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "Image" }).getAttribute("src")).toBe("blob:a");
  });

  // 安卓返回键：不拦就一路冒到聊天页，表现为「看个图退出整个会话」
  it("系统返回键只关预览，并消费掉这次返回", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ImageLightbox urls={["blob:x"]} onClose={onClose} />);

    expect(runBackInterceptors()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    // 卸载后必须注销，否则已关闭的预览会继续吞返回键
    unmount();
    expect(runBackInterceptors()).toBe(false);
  });

  it("关闭按钮与页码避开状态栏（留出 --safe-area-top）", () => {
    render(<ImageLightbox urls={["blob:a", "blob:b"]} onClose={() => {}} />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.getAttribute("style") ?? "").toContain("--safe-area-top");
    expect(screen.getByTestId("lightbox-counter").getAttribute("style") ?? "").toContain(
      "--safe-area-top",
    );
  });
});
