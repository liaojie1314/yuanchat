/**
 * 命令面板的动作注册表。
 *
 * @description
 * 单独成文件而不是留在 CommandPalette.tsx 里：组件文件导出非组件会触发
 * eslint `react-refresh/only-export-components`，与 navItems.ts 同一种拆法。
 *
 * 每个动作带一组 `keywords` 供匹配 —— 只按显示文案匹配的话，
 * 中文界面下输入 "theme" 什么都搜不到。刻意**不做**拼音首字母匹配：
 * 中文模糊匹配是个独立课题，不值得在本批里自造一套。
 */
import {
  MessageCircle,
  Users,
  Settings,
  Camera,
  Sticker,
  Star,
  SunMoon,
  LogOut,
  UserPlus,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

/** 执行动作时需要的宿主能力（面板自己不持有路由与 store） */
export interface PaletteContext {
  navigate: (to: string) => void;
  toggleTheme: () => void;
  logout: () => void;
  /** 桌面 app 内为 true —— 决定「检查更新」这类仅桌面可用的动作是否出现 */
  isDesktopApp: boolean;
  /**
   * 打开桌面端更新检查。
   *
   * @remarks 由宿主注入（桌面端 UpdateChecker 持有 updater 插件句柄）；
   * 未注入时「检查更新」动作执行为空操作 —— 动作的出现只看 isDesktopApp，
   * 是否能真正干活由宿主决定，避免 ui 包反向依赖 tauri 插件。
   */
  checkUpdate?: () => void;
}

/** 一个可执行的快捷动作 */
export interface PaletteAction {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  /** 额外匹配词（英文/别名），与 labelKey 的译文一起参与匹配 */
  keywords: string[];
  run: (ctx: PaletteContext) => void;
  /**
   * 独立搜索窗口形态下是否保留。
   *
   * @remarks true 表示动作只做路由跳转，可安全经跨窗口导航桥在**主窗口**落地；
   *   切主题 / 登出这类改「执行时所在窗口」store 的动作不带此标记 —— 搜索窗口是
   *   独立 JS 上下文，在那里执行它们会动到错误的上下文（登出会把主窗口仍持有的
   *   token 从 localStorage 抽掉，主窗口却还亮着），而主题切换只改一半窗口。
   */
  windowSafe?: boolean;
}

/** buildPaletteActions 的可选项 */
export interface PaletteActionsOptions {
  /**
   * 只保留 {@link PaletteAction.windowSafe} 的动作 —— 独立搜索窗口形态用。
   * 不传（默认）返回完整动作表，主窗口面板形态行为不变。
   */
  navigationOnly?: boolean;
}

/** 按宿主能力构造动作列表 */
export function buildPaletteActions(
  ctx: PaletteContext,
  opts?: PaletteActionsOptions,
): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: "new-group",
      labelKey: "chat.group.create",
      icon: UserPlus,
      keywords: ["group", "qun", "新建群聊"],
      windowSafe: true,
      run: (c) => c.navigate("/contacts?new=group"),
    },
    {
      id: "go-chat",
      labelKey: "chat.title",
      icon: MessageCircle,
      keywords: ["chat", "message"],
      windowSafe: true,
      run: (c) => c.navigate("/chat"),
    },
    {
      id: "go-contacts",
      labelKey: "contacts.title",
      icon: Users,
      keywords: ["contacts", "friends"],
      windowSafe: true,
      run: (c) => c.navigate("/contacts"),
    },
    {
      id: "go-moments",
      labelKey: "moments.title",
      icon: Camera,
      keywords: ["moments", "feed"],
      windowSafe: true,
      run: (c) => c.navigate("/moments"),
    },
    {
      id: "go-favorites",
      labelKey: "favorites.title",
      icon: Star,
      keywords: ["favorites", "saved"],
      windowSafe: true,
      run: (c) => c.navigate("/favorites"),
    },
    {
      id: "go-stickers",
      labelKey: "sticker.market.title",
      icon: Sticker,
      keywords: ["stickers", "emoji", "market"],
      windowSafe: true,
      run: (c) => c.navigate("/stickers"),
    },
    {
      id: "go-settings",
      labelKey: "settings.title",
      icon: Settings,
      keywords: ["settings", "preferences"],
      windowSafe: true,
      run: (c) => c.navigate("/settings"),
    },
    {
      id: "toggle-theme",
      labelKey: "palette.toggleTheme",
      icon: SunMoon,
      keywords: ["theme", "dark", "light"],
      run: (c) => c.toggleTheme(),
    },
    {
      id: "logout",
      labelKey: "settings.logout",
      icon: LogOut,
      keywords: ["logout", "signout"],
      run: (c) => c.logout(),
    },
  ];

  // 更新检查只有桌面端有（移动端无 updater 插件，web 端无从谈起）；
  // 宿主未注入 checkUpdate 时动作仍在（见 PaletteContext.checkUpdate 备注），执行为空操作
  if (ctx.isDesktopApp) {
    actions.push({
      id: "check-update",
      labelKey: "update.check",
      icon: RefreshCw,
      keywords: ["update", "upgrade", "version"],
      run: (c) => c.checkUpdate?.(),
    });
  }
  // 独立搜索窗口只留导航类：改上下文的动作在错误窗口执行（见 windowSafe 备注）
  return opts?.navigationOnly ? actions.filter((a) => a.windowSafe === true) : actions;
}

/**
 * 按查询词过滤动作。空查询返回全部。
 *
 * @param t 译函数 —— 匹配要同时看译文与 keywords，否则中文界面下输入英文搜不到
 */
export function filterActions(
  actions: PaletteAction[],
  q: string,
  t: (key: string) => string,
): PaletteAction[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return actions;
  return actions.filter(
    (a) =>
      t(a.labelKey).toLowerCase().includes(needle) ||
      a.keywords.some((k) => k.toLowerCase().includes(needle)),
  );
}
