import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../primitives/Input";

describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="请输入" />);
    expect(screen.getByPlaceholderText("请输入")).toBeInTheDocument();
  });

  it("calls onChange when typing", () => {
    const onChange = vi.fn();
    render(<Input placeholder="输入" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("输入"), {
      target: { value: "hello" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("displays error message", () => {
    render(<Input placeholder="输入" error="长度不足" />);
    expect(screen.getByText("长度不足")).toBeInTheDocument();
  });

  it("applies error border class when error is set", () => {
    render(<Input placeholder="输入" error="出错了" />);
    const input = screen.getByPlaceholderText("输入");
    expect(input.className).toContain("border-error");
  });

  it("renders password toggle button for type=password", () => {
    render(<Input type="password" placeholder="密码" />);
    // 密码输入框应有关闭眼睛图标按钮
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
  });

  it("toggles password visibility on button click", () => {
    render(<Input type="password" placeholder="密码" />);
    const input = screen.getByPlaceholderText("密码") as HTMLInputElement;
    const btn = screen.getByRole("button");

    // 初始状态：password
    expect(input.type).toBe("password");

    // 点击切换为 text
    fireEvent.click(btn);
    expect(input.type).toBe("text");

    // 再次点击切换为 password
    fireEvent.click(btn);
    expect(input.type).toBe("password");
  });

  it("does not show toggle button for text type", () => {
    render(<Input type="text" placeholder="文本" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("forwards ref to input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(
      <Input
        placeholder="ref"
        ref={(el) => {
          ref.current = el;
        }}
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
