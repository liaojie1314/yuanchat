import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("renders initials from name", () => {
    render(<Avatar name="张三" />);
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("renders two-character initials", () => {
    render(<Avatar name="李四五六" />);
    // 取前两个字符
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("renders fallback when no src provided", () => {
    render(<Avatar name="Test" />);
    // Radix Avatar renders a span with the initials
    expect(screen.getByText("TE")).toBeInTheDocument();
  });

  it("renders online indicator when online=true", () => {
    const { container } = render(<Avatar name="用户" online={true} />);
    // 在线指示器是一个 span，带有 rounded-full 类
    const indicator = container.querySelector("span.absolute");
    expect(indicator).toBeInTheDocument();
  });

  it("does not render online indicator when online is undefined", () => {
    const { container } = render(<Avatar name="用户" />);
    const indicator = container.querySelector("span.absolute");
    expect(indicator).toBeNull();
  });
});
