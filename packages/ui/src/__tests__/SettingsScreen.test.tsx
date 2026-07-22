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
import { SettingsScreen } from "../SettingsScreen";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, useBreakpoint: () => "desktop" };
});

describe("SettingsScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "u1", nickname: "Alice", shortId: 10001, phone: "13800000001" },
      isAuthenticated: true,
    });
  });

  it("渲染分组导航与用户卡片", () => {
    render(<SettingsScreen />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Account & Security")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });

  it("账号页手机号脱敏", () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByText("Account & Security"));
    expect(screen.getByText("138****0001")).toBeInTheDocument();
  });
});
