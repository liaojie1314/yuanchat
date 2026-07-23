/**
 * MainLayout 集成测试
 *
 * 测试范围：路由导航 + 主题切换 + 登出按钮
 * 依赖：react-router-dom (MemoryRouter)、themeStore、authStore
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MainLayout } from "../MainLayout";
import { useThemeStore, useAuthStore } from "@yuanchat/shared";

beforeEach(() => {
  // Spy on DOM APIs instead of replacing document entirely
  // (jsdom provides working document.body/head for React rendering)
  vi.spyOn(document.documentElement.style, "setProperty").mockImplementation(() => {});
  vi.spyOn(document.documentElement.classList, "toggle").mockImplementation(() => false);

  useThemeStore.setState({
    skinId: "yuan-light",
    mode: "light",
    fontScale: "normal",
  });
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
});
