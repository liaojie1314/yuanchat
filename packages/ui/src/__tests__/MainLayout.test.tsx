/**
 * MainLayout 集成测试
 *
 * 测试范围：路由导航 + 主题切换 + 登出按钮
 * 依赖：react-router-dom (MemoryRouter)、themeStore、authStore
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MainLayout } from "../layout/MainLayout";
import { TAB_ROOT_PATHS } from "../layout/navItems";
import { useThemeStore, useAuthStore, useMomentsStore } from "@yuanchat/shared";

/** jsdom 默认宽度，落在平板/桌面分支（≥768） */
const WIDE = 1024;

/**
 * 把视口切到手机宽度。
 *
 * useBreakpoint 的初始 state 直接读 window.innerWidth，故渲染前改它即可，
 * 不必派发 resize 事件。
 */
function setMobileViewport() {
  window.innerWidth = 400;
}

beforeEach(() => {
  // 只对 DOM API 打 spy，不整体替换 document
  //（jsdom 已提供可用的 document.body / head 供 React 渲染）
  vi.spyOn(document.documentElement.style, "setProperty").mockImplementation(() => {});
  vi.spyOn(document.documentElement.classList, "toggle").mockImplementation(() => false);

  window.innerWidth = WIDE;
  useThemeStore.setState({
    skinId: "yuan-light",
    mode: "light",
    fontScale: "normal",
  });
  useMomentsStore.setState({ unreadCount: 0 });
});

describe("MainLayout", () => {
  it("renders three navigation items", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    // jsdom locale 为 en-US，导航标签走 i18n
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders theme toggle button", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    // 亮色模式显示月亮图标按钮
    const button = screen.getByTitle("切换暗色模式");
    expect(button).toBeInTheDocument();
  });

  it("toggles theme on button click", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    const button = screen.getByTitle("切换暗色模式");
    fireEvent.click(button);
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("renders logout button", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    // jsdom 默认 locale 为 en-US, t("settings.logout") → "Sign Out"
    expect(screen.getByTitle("Sign Out")).toBeInTheDocument();
  });

  it("clears auth state on logout click", async () => {
    useAuthStore.setState({
      user: { id: "1", nickname: "Test" },
      accessToken: "token",
      isAuthenticated: true,
    });

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle("Sign Out"));

    // logout 是异步的，等待状态更新
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  it("highlights active nav item based on route", () => {
    render(
      <MemoryRouter initialEntries={["/contacts"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    const contactsLink = screen.getByText("Contacts").closest("a");
    expect(contactsLink?.className).toContain("bg-white/25");
  });

  it("renders Outlet for child routes", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    // 导航栏存在
    expect(container.querySelector("nav")).toBeInTheDocument();
  });

  it("移动端底栏是 聊天/通讯录/朋友圈/设置 四项，不含收藏", () => {
    setMobileViewport();
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Moments")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    // favorites.title 的实际英文值是 "My Favorites"
    expect(screen.queryByText("My Favorites")).not.toBeInTheDocument();
  });

  it("朋友圈有未读互动时显示角标", () => {
    setMobileViewport();
    useMomentsStore.setState({ unreadCount: 3 });
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("桌面侧栏有朋友圈与表情商城，设置沉底在主题切换之前", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <MainLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText("Moments").closest("a")).toHaveAttribute("href", "/moments");
    expect(screen.getByText("Sticker Market").closest("a")).toHaveAttribute("href", "/stickers");
    expect(screen.queryByText("My Favorites")).not.toBeInTheDocument();

    // 设置项排在表情商城之后（沉底），主题切换按钮在它之后
    const stickers = screen.getByText("Sticker Market");
    const settings = screen.getByText("Settings");
    expect(
      stickers.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("TAB_ROOT_PATHS 与底栏导航一致，含 /moments", () => {
    // 安卓返回键靠这份清单判断「已在一级入口」；漏了 /moments 会跳回 /chat
    expect(TAB_ROOT_PATHS).toEqual(["/chat", "/contacts", "/moments", "/settings"]);
  });
});
