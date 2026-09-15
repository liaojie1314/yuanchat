import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../primitives/Button";

describe("Button", () => {
  it("renders children text", () => {
    render(<Button>发送</Button>);
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点击</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        禁用
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders with primary variant by default", () => {
    render(<Button>主按钮</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-primary");
  });

  it("renders with secondary variant", () => {
    render(<Button variant="secondary">次要</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-surface-container-low");
  });

  it("renders with ghost variant", () => {
    render(<Button variant="ghost">幽灵</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-on-surface");
  });

  it("renders with danger variant", () => {
    render(<Button variant="danger">危险</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-error");
  });

  it("applies additional className", () => {
    render(<Button className="extra-class">按钮</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("extra-class");
  });

  it("forwards ref to button element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Button
        ref={(el) => {
          ref.current = el;
        }}
      >
        按钮
      </Button>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
