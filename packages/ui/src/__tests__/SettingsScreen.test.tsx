/**
 * SettingsScreen 集成测试
 *
 * 测试范围：分组导航 + 用户卡片渲染、账号页手机号脱敏。
 * 依赖：authStore（直接 setState 预置）、useBreakpoint（默认 desktop，首屏用例覆盖 mobile）。
 *
 * jsdom 默认 locale 为 en-US，setup.ts 已初始化 i18n，
 * 因此所有 t() 文案断言使用英文值（与 ChatDetail.test 风格一致）。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAuthStore, useBreakpoint } from "@yuanchat/shared";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SettingsScreen } from "../settings/SettingsScreen";

// 收藏已改成设置页内的子视图，渲染时会真的去拉列表；这里给个空结果，
// 免得测试里发真实请求（失败后只会吞成一个 toast，反而看不出问题）
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    useBreakpoint: vi.fn(() => "desktop"),
    listFavorites: vi.fn(async () => ({ favorites: [], has_more: false })),
  };
});

beforeEach(() => {
  vi.mocked(useBreakpoint).mockReturnValue("desktop");
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
      user: { id: "u1", nickname: "Alice", shortId: 10001, email: "alice@yuanchat.com" },
      isAuthenticated: true,
    });
  });

  it.each([
    ["/settings", "Settings"],
    ["/settings?section=about", "About"],
  ])("手机进入 %s 从首次提交起就不挂载个人资料表单", (path, title) => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const mountedProfileFields: HTMLElement[] = [];
    render(
      <MemoryRouter initialEntries={[path]}>
        <Profiler
          id="settings"
          // 在每次 DOM 提交后观察真实表单，避免 render 自动执行 effect 后漏掉错误首帧。
          onRender={() => mountedProfileFields.push(...screen.queryAllByDisplayValue("Alice"))}
        >
          <SettingsScreen />
        </Profiler>
      </MemoryRouter>,
    );
    expect(mountedProfileFields).toHaveLength(0);
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("渲染分组导航与用户卡片", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Account & Security")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("手机通用设置保留主题和下载目录，不显示键盘快捷键", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /General/ }));
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "File downloads" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("账号页列出邮箱与元聊号（手机号已不再是账号字段）", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Account & Security"));
    expect(screen.getByText("alice@yuanchat.com")).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.queryByText("Phone")).toBeNull();
  });

  it("桌面端不渲染退出登录（登出唯一入口在左侧导航栏）", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Sign Out")).toBeNull();
  });

  it("桌面左列不列表情商城（侧栏已有入口），收藏排在关于之上", () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    // favorites.title 的实际英文值是 "My Favorites"
    const favorites = screen.getByText("My Favorites");
    const about = screen.getByText("About");
    // 表情商城标了 mobileOnly：桌面主侧栏已有该入口，设置页再列一遍是重复
    expect(screen.queryByText("Sticker Market")).toBeNull();
    expect(
      favorites.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("点收藏在设置页内展开收藏，不跳走", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsScreen />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("My Favorites"));
    // 收藏内容出现在右栏（标签行），且路由仍停在 /settings
    expect(await screen.findByText("All")).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/settings|");
  });
});

it("命令面板的关于深链直接展示宿主更新区块", () => {
  render(
    <MemoryRouter initialEntries={["/settings?section=about&checkUpdate=1"]}>
      <SettingsScreen aboutExtra={<p data-testid="update-slot">update</p>} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("update-slot")).toBeInTheDocument();
});

it("文件下载并入通用设置，与主题和快捷键同页且没有独立导航", () => {
  render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: /File downloads/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /General/ }));
  expect(screen.getByRole("heading", { name: "File downloads" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  expect(screen.getByText(/browser controls where files are saved/i)).toBeInTheDocument();
});
