/**
 * SettingsScreen 集成测试
 *
 * 测试范围：分组导航 + 用户卡片渲染、账号页手机号脱敏。
 * 依赖：authStore（直接 setState 预置）、useBreakpoint（mock 为 desktop）。
 *
 * jsdom 默认 locale 为 en-US，setup.ts 已初始化 i18n，
 * 因此所有 t() 文案断言使用英文值（与 ChatDetail.test 风格一致）。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAuthStore } from "@yuanchat/shared";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SettingsScreen } from "../settings/SettingsScreen";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, useBreakpoint: () => "desktop" };
});

/** 探针：把当前路由与 state.from 暴露成文本，供跳转断言 */
function LocationProbe() {
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "";
  return <div data-testid="loc">{`${loc.pathname}|${from}`}</div>;
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "u1", nickname: "Alice", shortId: 10001, phone: "13800000001" },
      isAuthenticated: true,
    });
  });

  it("渲染分组导航与用户卡片", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Account & Security")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });

  it("账号页手机号脱敏", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Account & Security"));
    expect(screen.getByText("138****0001")).toBeInTheDocument();
  });

  it("桌面端不渲染退出登录（登出唯一入口在左侧导航栏）", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Sign Out")).toBeNull();
  });

  it("桌面左列有表情商城与收藏，收藏排在关于之上", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    // favorites.title 的实际英文值是 "My Favorites"
    const favorites = screen.getByText("My Favorites");
    const about = screen.getByText("About");
    expect(screen.getByText("Sticker Market")).toBeInTheDocument();
    expect(
      favorites.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("点收藏跳 /favorites 并带来源", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsScreen />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("My Favorites"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/favorites|/settings");
  });
});
