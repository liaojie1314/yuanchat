/**
 * SearchWindowPage 桥接测试 —— 把「选中必关窗」钉死。
 *
 * 用户实测踩过的坑：搜索窗口选中条目后主窗口跳了，搜索窗口却还开着。
 * 链路上每一环都可能在真机才暴露（emit 与 close 的时序、emit 失败被 catch
 * 吞掉后忘关窗），所以这里全程 mock `@tauri-apps/api/event` 与
 * `@tauri-apps/api/window`，从组件交互一路钉到 emit/close 的调用形状：
 *   1. Enter 选中 → 先 emit("search:navigate", payload) 再 close；
 *   2. emit 抛错（非 Tauri / 无桥）也必须照常 close；
 *   3. 标题栏关闭按钮 → close（不 emit）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useConversationStore, useContactStore } from "@yuanchat/shared";

const emit = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emit(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useConversationStore.setState({
    conversations: [],
    loadConversations: vi.fn().mockResolvedValue(undefined),
  });
  useContactStore.setState({ loadFriends: vi.fn().mockResolvedValue(undefined) });
});

async function mountPage() {
  const { SearchWindowPage } = await import("../pages/SearchWindowPage");
  render(
    <MemoryRouter initialEntries={["/search-window"]}>
      <SearchWindowPage />
    </MemoryRouter>,
  );
}

describe("SearchWindowPage 跨窗口导航桥", () => {
  it("选中条目 → 先 emit search:navigate 再关窗（选中必关窗）", async () => {
    await mountPage();
    // 第一个动作是 new-group → 主窗口跳 /contacts?new=group
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "search:navigate",
      expect.objectContaining({ path: "/contacts?new=group" }),
    );
  });

  it("emit 失败不阻断关窗：导航没落地顶多白选一次，窗口不能残留", async () => {
    emit.mockRejectedValueOnce(new Error("no bridge (browser dev)"));
    await mountPage();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("Escape 关窗但不 emit（没有选中就没有导航）", async () => {
    await mountPage();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(emit).not.toHaveBeenCalled();
  });

  it("标题栏关闭按钮 → 只关窗、不 emit", async () => {
    await mountPage();
    fireEvent.click(screen.getByRole("button", { name: /关闭搜索|Close search/i }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(emit).not.toHaveBeenCalled();
  });
});
