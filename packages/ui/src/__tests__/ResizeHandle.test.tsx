import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ResizeHandle } from "../ResizeHandle";

describe("ResizeHandle", () => {
  it("renders with default transparent background", () => {
    const { container } = render(<ResizeHandle />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("bg-transparent");
  });

  it("applies primary color when dragging", () => {
    const { container } = render(<ResizeHandle isDragging={true} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("bg-primary");
  });

  it("applies custom className", () => {
    const { container } = render(<ResizeHandle className="custom" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("custom");
  });

  it("calls onMouseDown when clicked", () => {
    const onMouseDown = vi.fn();
    const { container } = render(<ResizeHandle onMouseDown={onMouseDown} />);
    fireEvent.mouseDown(container.firstElementChild!);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});
