/**
 * SearchWindowHost 单测（独立搜索窗口的窗口内部分）。
 *
 * 钉三件事：
 *   1. 挂载即各拉一次本地源（loadConversations / loadFriends）—— 独立 JS 上下文
 *      store 为空，不拉则「最近会话」与联系人本地过滤没数据；
 *   2. 标题栏关闭按钮走 onClose（窗口的关闭语义归宿主）；
 *   3. 里面渲染的是 window 形态的 CommandPalette（常开、无遮罩）。
 *
 * Tauri 侧的 emit/关窗链路在 apps/desktop 的 searchWindowPage.test.tsx 钉。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useConversationStore, useContactStore } from "@yuanchat/shared";
import { SearchWindowHost } from "../SearchWindowHost";

beforeEach(() => {
  vi.clearAllMocks();
  useConversationStore.setState({
    conversations: [],
    loadConversations: vi.fn().mockResolvedValue(undefined),
  });
  useContactStore.setState({ loadFriends: vi.fn().mockResolvedValue(undefined) });
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("SearchWindowHost", () => {
  it("挂载即各拉一次会话与好友（失败静默，不弹错误）", async () => {
    const loadConversations = vi.fn().mockResolvedValue(undefined);
    const loadFriends = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ loadConversations });
    useContactStore.setState({ loadFriends });

    const { unmount } = wrap(<SearchWindowHost onClose={vi.fn()} />);
    await Promise.resolve(); // 放行 effect 里的 void promise
    expect(loadConversations).toHaveBeenCalledTimes(1);
    expect(loadFriends).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("拉取失败被吞掉：不向外传播，组件照常渲染", async () => {
    const loadConversations = vi.fn().mockRejectedValue(new Error("offline"));
    const loadFriends = vi.fn().mockRejectedValue(new Error("offline"));
    useConversationStore.setState({ loadConversations });
    useContactStore.setState({ loadFriends });

    // 未捕获的 rejection 会让 vitest 直接红 —— 能走完本用例就是「静默降级」的证明
    const { unmount } = wrap(<SearchWindowHost onClose={vi.fn()} />);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    unmount();
  });

  it("标题栏关闭按钮走 onClose（关窗语义归宿主）", () => {
    const onClose = vi.fn();
    wrap(<SearchWindowHost onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /关闭搜索|Close search/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("内部渲染 window 形态面板：常开、无 fixed 遮罩", () => {
    const onClose = vi.fn();
    wrap(<SearchWindowHost onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    expect(dialog.className).not.toContain("fixed");
  });

  it("onNavigate 透传给 CommandPalette：选中条目经宿主出窗，关窗归 page 桥", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    wrap(<SearchWindowHost onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    // 关窗由 page 的 navigateAndClose 负责（emit 后 closeSelf），
    // palette 不再回关 onClose —— 双 close 链会竞态
    expect(onClose).not.toHaveBeenCalled();
  });
});
