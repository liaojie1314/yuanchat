import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../primitives/Avatar";

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
    // Radix Avatar 会渲染一个带首字母的 span
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

  it("statusEmoji 渲染右下角状态角标", () => {
    render(<Avatar name="用户" statusEmoji="🌊" />);
    expect(screen.getByText("🌊")).toBeInTheDocument();
  });

  it("状态角标与 presence 圆点同位，状态优先", () => {
    const { container } = render(<Avatar name="用户" presence="online" statusEmoji="🌊" />);
    expect(screen.getByText("🌊")).toBeInTheDocument();
    // presence 圆点的语义色类不应再出现
    expect(container.querySelector(".bg-emerald-500")).toBeNull();
  });

  it("statusEmoji 为空串时退回 presence 圆点", () => {
    const { container } = render(<Avatar name="用户" presence="online" statusEmoji="" />);
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });
});
