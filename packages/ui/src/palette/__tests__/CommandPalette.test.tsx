/**
 * CommandPalette 单测
 *
 * @description
 * 两组：
 *   1. paletteActions 纯函数 —— 动作注册表按宿主能力裁剪（web 无「检查更新」）、
 *      匹配同时看译文与 keywords。
 *   2. CommandPalette 组件 —— 命令模式（动作列表 + 键盘 + Escape）与
 *      搜索模式（MSW 四态里的正常态分组渲染 + 类型筛选写进请求串）。
 *
 * 服务端结果由 shared 的 MSW handlers 提供（mockSearchResults 覆盖
 * text/file/image 三类），本包不直接依赖 msw —— 复用
 * @yuanchat/shared/mocks/server 收敛导出的 Node 服务。
 *
 * 查询词用「季度报告」（4 个字符）：面板与后端同口径，≥3 个字符才打服务端
 * （GIN 索引下限），2 字符查询不会发出请求、也就没有分组结果可言。
 *
 * 交互用 fireEvent 而非 user-event：后者不在本仓任何 package.json 里，
 * 离线环境装不了；本包既有用例（MainLayout 等）也统一走 fireEvent。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { server } from "@yuanchat/shared/mocks/server";
import { useConversationStore } from "@yuanchat/shared";
import { buildPaletteActions, filterActions } from "../paletteActions";
import { CommandPalette } from "../CommandPalette";

const ctx = { navigate: vi.fn(), toggleTheme: vi.fn(), logout: vi.fn(), isDesktopApp: false };

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe("paletteActions", () => {
  it("web 端不包含「检查更新」（没有 updater）", () => {
    const ids = buildPaletteActions(ctx).map((a) => a.id);
    expect(ids).not.toContain("check-update");
  });

  it("桌面端包含「检查更新」", () => {
    const ids = buildPaletteActions({ ...ctx, isDesktopApp: true }).map((a) => a.id);
    expect(ids).toContain("check-update");
  });

  it("按 keywords 匹配，不只按显示文案", () => {
    const actions = buildPaletteActions(ctx);
    const t = (k: string) => k;
    // "theme" 是 keywords 里的词，显示文案是中文「切换主题」
    const hit = filterActions(actions, "theme", t);
    expect(hit.map((a) => a.id)).toContain("toggle-theme");
  });

  it("空查询返回全部动作", () => {
    const actions = buildPaletteActions(ctx);
    expect(filterActions(actions, "", (k) => k)).toHaveLength(actions.length);
  });

  // 独立搜索窗口形态只保留导航类动作：切主题/登出/检查更新动的是「执行时所在
  // 窗口」的 store 上下文，在搜索窗口（独立 JS 上下文）里执行会动错地方 ——
  // 登出会把主窗口仍持有的 token 从 localStorage 抽掉，主题切换只改一半窗口。
  it("navigationOnly 裁掉会动本窗口上下文的动作，只留可经导航桥跳转的", () => {
    const ids = buildPaletteActions(ctx, { navigationOnly: true }).map((a) => a.id);
    expect(ids).not.toContain("toggle-theme");
    expect(ids).not.toContain("logout");
    expect(ids).not.toContain("check-update");
    expect(ids).toContain("go-settings");
    expect(ids).toContain("new-group");
  });
});

describe("CommandPalette", () => {
  beforeEach(() => vi.clearAllMocks());

  const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("空输入时渲染动作列表而不是搜索结果", () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  // 路由大量 replace 使 WebView 历史恒为 1，安卓上面板开着按返回键
  // 原生兜底就是退出应用。拦截器必须同步关面板并消费返回。
  it("面板打开时安卓返回键被拦截并关面板；未打开时不拦截", async () => {
    const { runBackInterceptors } = await import("@yuanchat/shared");
    const onClose = vi.fn();

    // 未打开：不注册拦截，返回键交回系统（此处即无人消费）
    const closed = wrap(<CommandPalette show={false} onClose={onClose} />);
    expect(runBackInterceptors()).toBe(false);
    closed.unmount();

    // 打开：返回 = 关面板，且消费掉本次返回（不退出应用）
    const opened = wrap(<CommandPalette show onClose={onClose} />);
    expect(runBackInterceptors()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    opened.unmount();

    // 卸载后拦截器随之注销，不留残余吞返回键
    expect(runBackInterceptors()).toBe(false);
  });

  it("↑↓ 移动选中项，aria-selected 跟随", () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const opts = screen.getAllByRole("option");
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Escape 调 onClose", () => {
    const onClose = vi.fn();
    wrap(<CommandPalette show onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("输入后进搜索模式并按类别分组渲染", async () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度报告" } });
    // MSW 的 mockSearchResults 含 text 与 file 两类
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /消息|Messages/i })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: /文件|Files/i })).toBeInTheDocument();
    });
  });

  it("点类型筛选器后请求带上 types 参数", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    wrap(<CommandPalette show onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度报告" } });
    fireEvent.click(screen.getByRole("button", { name: /文件|Files/i }));
    await waitFor(() => {
      const urls = spy.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("types=file"))).toBe(true);
    });
  });
});

// ── window 形态（独立搜索窗口）───────────────────────────────────────────────
describe("CommandPalette window 形态（独立搜索窗口）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({ conversations: [] });
  });

  const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("常开渲染：不传 show 也出 listbox，且没有 panel 形态的 fixed 遮罩层", () => {
    wrap(<CommandPalette variant="window" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    expect(dialog.className).not.toContain("fixed");
    expect(dialog.className).not.toContain("bg-black");
  });

  // 用户实测踩过的坑：选完条目搜索窗口留在屏幕上。「选中必关窗」由宿主桥一条路
  // 负责（onNavigate → 关窗）：palette 若再自己关一次，两条 close 链互相竞态，
  // close 计数在 0/2 之间飘（桌面 page 桥测试同题）。
  it("选中条目走 onNavigate 出窗，关窗归宿主桥、palette 不重复关", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    wrap(<CommandPalette variant="window" onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    // 第一个动作是 new-group → 跳通讯录建群
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0]).toBe("/contacts?new=group");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("未传 onNavigate 时 palette 自己关窗（无宿主桥的降级路径也要选中必关窗）", () => {
    const onClose = vi.fn();
    wrap(<CommandPalette variant="window" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 只关窗、不导航", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    wrap(<CommandPalette variant="window" onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("未传 onNavigate 时回落本地 useNavigate（浏览器 dev 的降级路径）", () => {
    const paths: string[] = [];
    function LocationProbe() {
      paths.push(useLocation().pathname + useLocation().search);
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <CommandPalette variant="window" onClose={vi.fn()} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(paths).toContain("/contacts?new=group");
  });

  it("会话类结果把 conversationId 装进 meta 交给主窗口（主窗口需先 setActive）", async () => {
    useConversationStore.setState({
      conversations: [
        { id: "c1", type: "group", name: "季度汇报群", unreadCount: 0, isMuted: false },
      ],
    });
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    wrap(<CommandPalette variant="window" onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度汇报群" } });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /季度汇报群/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: /季度汇报群/ }));
    expect(onNavigate).toHaveBeenCalledWith(
      "/chat/c1",
      expect.objectContaining({ conversationId: "c1" }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
