import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "../EmojiPicker";

// jsdom 默认 locale 为 en-US，分类 tab 文案断言使用英文标签
describe("EmojiPicker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("点击 emoji 触发 onPick 并写入最近使用", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />);
    const first = screen.getAllByRole("button", { name: /😀|😄|😁/ })[0];
    fireEvent.click(first);
    expect(onPick).toHaveBeenCalledTimes(1);
    const recent = JSON.parse(localStorage.getItem("yuanchat-recent-emojis") || "[]");
    expect(recent.length).toBe(1);
  });

  it("分类 tab 切换", () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Animals" }));
    expect(screen.getByText("🐶")).toBeInTheDocument();
  });

  it("选择后出现最近使用分类", () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />);
    // 初始无最近使用 tab
    expect(screen.queryByRole("tab", { name: "Recent" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /😀|😄|😁/ })[0]);
    expect(screen.getByRole("tab", { name: "Recent" })).toBeInTheDocument();
  });
});
