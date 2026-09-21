/**
 * UserStatusEditor 测试
 *
 * jsdom 默认 locale 为 en-US，故文案断言用英文值。
 * 保存走 authStore.updateProfile（组件只负责把界面选择拼成 patch），
 * 因此用 setState 换掉该 action 后断言收到的 patch。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAuthStore } from "@yuanchat/shared";
import { UserStatusEditor } from "../settings/UserStatusEditor";
import { secondsUntilEndOfDay } from "../settings/settingsUtils";

/** 替换 updateProfile 的 spy，每个用例重置 */
let saved: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = vi.fn().mockResolvedValue(undefined);
  useAuthStore.setState({
    user: { id: "u1", nickname: "Alice", statusEmoji: "", statusText: "" },
    isAuthenticated: true,
    updateProfile: saved,
  });
});

describe("UserStatusEditor", () => {
  it("open=false 不渲染", () => {
    const { container } = render(<UserStatusEditor open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("选 emoji + 输入文案，默认不清除（statusDuration 0）", async () => {
    render(<UserStatusEditor open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "🌊" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "On vacation" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        statusEmoji: "🌊",
        statusText: "On vacation",
        statusDuration: 0,
      }),
    );
  });

  it("文案上限 64 字", () => {
    render(<UserStatusEditor open onClose={() => {}} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "x".repeat(80) } });
    expect((box as HTMLTextAreaElement).value).toHaveLength(64);
  });

  it("选 1 小时档，statusDuration 为 3600", async () => {
    render(<UserStatusEditor open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "🌊" }));
    fireEvent.click(screen.getByText("1 hour"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(expect.objectContaining({ statusDuration: 3600 })),
    );
  });

  it("选「今天」档，statusDuration 为本地时区当日剩余秒数", async () => {
    render(<UserStatusEditor open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "🌊" }));
    fireEvent.click(screen.getByText("Today"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const patch = saved.mock.calls[0][0] as { statusDuration: number };
    // 与工具函数同口径，容忍用例执行期间跨过的几秒
    expect(Math.abs(patch.statusDuration - secondsUntilEndOfDay())).toBeLessThan(5);
  });

  it("清除状态发空串且时长归零", async () => {
    useAuthStore.setState({
      user: { id: "u1", nickname: "Alice", statusEmoji: "🌊", statusText: "On vacation" },
      isAuthenticated: true,
      updateProfile: saved,
    });
    render(<UserStatusEditor open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Clear status"));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        statusEmoji: "",
        statusText: "",
        statusDuration: 0,
      }),
    );
  });

  it("没选 emoji 时保存键禁用（纯文字状态后端也认，但界面要求先挑一个）", () => {
    render(<UserStatusEditor open onClose={() => {}} />);
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });
});

describe("secondsUntilEndOfDay", () => {
  it("按本地时区算到当日 23:59:59", () => {
    const at = new Date(2026, 8, 20, 23, 0, 0, 0);
    // 距 23:59:59.999 还有 59 分 59.999 秒 → 四舍五入 3600
    expect(secondsUntilEndOfDay(at)).toBe(3600);
  });

  it("恰好跨日边界也至少返回 1 秒", () => {
    const at = new Date(2026, 8, 20, 23, 59, 59, 999);
    expect(secondsUntilEndOfDay(at)).toBe(1);
  });
});
