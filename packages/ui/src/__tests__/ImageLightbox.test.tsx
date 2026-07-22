import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageLightbox } from "../ImageLightbox";

// jsdom 默认 locale en-US，aria-label 文案断言用英文
describe("ImageLightbox", () => {
  it("renders the image at the given url", () => {
    render(<ImageLightbox url="blob:x" onClose={() => {}} />);
    const img = screen.getByRole("img", { name: "Image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:x");
  });

  it("closes on overlay click", () => {
    const onClose = vi.fn();
    render(<ImageLightbox url="blob:x" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(<ImageLightbox url="blob:x" onClose={onClose} />);
    // 关闭按钮点击会同时命中按钮自身与冒泡到遮罩的 onClose（"点击任意处关闭"设计），
    // 父层 setLightboxUrl(null) 幂等，多次调用无害——只断言确实触发了关闭
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<ImageLightbox url="blob:x" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores body overflow on unmount", () => {
    const { unmount } = render(<ImageLightbox url="blob:x" onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
