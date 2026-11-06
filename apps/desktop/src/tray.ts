/**
 * 桌面托盘与系统未读角标。
 *
 * @description
 * 零新依赖：Cargo.toml 的 tauri 已开 `tray-icon` feature，
 * JS 侧 `@tauri-apps/api/tray` 与 `window.setBadgeCount` / `setOverlayIcon`
 * 全是现成的，只需补 capability 权限。
 *
 * **刻意不生成带数字的图标。** Windows 与 macOS 本项目没有测试设备，
 * 而 `setOverlayIcon(Uint8Array)` 收 PNG 字节还是裸 RGBA 文档没讲清
 * （Rust 侧是裸 RGBA 的 Image，JS 签名却含 string | Image | Uint8Array）——
 * 在永远测不到的平台上押一个不确定的编码格式，等于写了行不通也不会被发现的代码。
 * 改为：macOS/Linux 用 setBadgeCount 让系统自己画数字，Windows 喂一张静态红点
 * PNG（走 allow-from-path，语义无歧义），**数字信息走托盘 tooltip 与菜单项**。
 * 详见设计文档 §1.3。
 *
 * 平台判定用 `@tauri-apps/plugin-os` 的 `platform()`（依赖已在 Cargo 与 npm
 * 两侧就位，本批零新增）。注意它在未授 `os:default` 权限时 reject，
 * capability 里必须带上；调用的所有失败都裹 try/catch 只 warn ——
 * 托盘与角标是增强，坏了应用必须照常用。
 *
 * **每次安装用独立的托盘 id**：React StrictMode 在 dev 下双跑 effect，
 * 挂载→卸载→再挂载挤在极短时间内。若所有实例共用一个 id，前一轮的
 * 卸载（按 id 移除）与后一轮的创建在 DBus 上乱序时，会把新托盘一并删掉
 * —— 表现为顶栏没有托盘图标、日志反复出现 register object 冲突。
 * 唯一 id 让每次 close 只关自己，天然免竞争，也不需要串行链。
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveResource } from "@tauri-apps/api/path";
import { Image } from "@tauri-apps/api/image";
import { platform } from "@tauri-apps/plugin-os";
import { TrayIcon, type TrayIconEvent } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import i18next from "i18next";
import { useConversationStore, selectTotalUnread, selectFirstUnreadId } from "@yuanchat/shared";

/** Windows 任务栏红点以 bundle.resources 打包，运行时必须先解析资源路径。 */
const BADGE_DOT_ICON = "icons/badge-dot-32.png";

/** 已装实例的序号，拼进托盘 id 保证唯一 */
let traySeq = 0;
/** 作废迟到的图标加载，未读清零后不能重新挂上红点。 */
let badgeRevision = 0;

/**
 * 把未读数反映到系统角标上。
 *
 * 所有调用都裹 try/catch 并只记 warn：Linux 的 setBadgeCount 走 Unity
 * LauncherEntry DBus，未装 `.desktop` 时会抛；角标是增强，失败了应用照常用。
 */
export async function applyBadge(count: number): Promise<void> {
  const revision = ++badgeRevision;
  const win = getCurrentWindow();
  try {
    if (platform() === "windows") {
      // Windows 不支持 setBadgeCount，只能用任务栏 overlay 图标。
      // 静态红点两态：有未读/无未读，计数在 tooltip 与菜单里
      if (count <= 0) {
        await win.setOverlayIcon(undefined);
        return;
      }
      const image = await Image.fromPath(await resolveResource(BADGE_DOT_ICON));
      try {
        if (revision === badgeRevision) await win.setOverlayIcon(image);
      } finally {
        await image.close();
      }
      return;
    }
    // 0 要传 undefined 而不是 0 —— Tauri 用 None 表示「移除角标」
    await win.setBadgeCount(count > 0 ? count : undefined);
  } catch (e) {
    console.warn("[tray] 系统角标不可用，已跳过", e);
  }
}

/** 托盘 tooltip 与菜单里的未读文案。托盘不在 React 上下文，i18next 直调 */
function unreadLabel(count: number): string {
  return count > 0 ? i18next.t("tray.unread", { count }) : i18next.t("tray.noUnread");
}

/**
 * 装上托盘图标并订阅未读变化。
 *
 * @param opts.onOpenConversation 左键点托盘时的跳转回调；参数为 null 表示
 *   没有未读，调用方应只聚焦窗口不做跳转
 * @returns 卸载函数（登出时调用，否则登出后托盘还挂着旧账号的未读数）
 */
export async function installTray(opts: {
  onOpenConversation: (id: string | null) => void;
}): Promise<() => void> {
  // id 唯一：StrictMode 的创建/销毁乱序也不会误删别的实例（见文件头说明）
  const trayId = `main-${(traySeq += 1)}`;
  const win = getCurrentWindow();

  /** 左键/菜单「打开」共用：把窗口带到前台并直达第一个未读 */
  const activate = async () => {
    // 隐藏（withdrawn）与最小化是两种状态，先 show 重新映射窗口；
    // 每步独立兜错 —— 一步失败（如对已隐藏窗口 unminimize）不能让
    // 后面的步骤被跳过，否则窗口永远唤不回
    const steps: Array<[string, () => Promise<void>]> = [
      ["show", () => win.show()],
      ["unminimize", () => win.unminimize()],
      ["setFocus", () => win.setFocus()],
      [
        // GNOME 的焦点防抢占会让 setFocus 不抬窗：短暂置顶再取消，强制顶到前台
        "raise",
        async () => {
          await win.setAlwaysOnTop(true);
          await win.setAlwaysOnTop(false);
        },
      ],
      // 从托盘唤回视为一次「重新打开」，居中呈现而不是停在上次的角落位置
      ["center", () => win.center()],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (e) {
        console.warn(`[tray] 激活窗口失败：${name}`, e);
      }
    }
    opts.onOpenConversation(selectFirstUnreadId(useConversationStore.getState().conversations));
  };

  const menu = await Menu.new({
    items: [
      { id: "tray-unread", text: unreadLabel(0), enabled: false },
      { id: "tray-open", text: i18next.t("tray.open"), action: () => void activate() },
      { id: "tray-quit", text: i18next.t("tray.quit"), action: () => void exit(0) },
    ],
  });

  const tray = await TrayIcon.new({
    id: trayId,
    icon: (await defaultWindowIcon()) ?? undefined,
    tooltip: i18next.t("tray.tooltip"),
    menu,
    // 左键直接激活窗口，不弹菜单 —— 菜单留给右键
    showMenuOnLeftClick: false,
    action: (event: TrayIconEvent) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Down") {
        void activate();
      }
    },
  });

  // 未读数同步：角标 + tooltip + 菜单项三处一起更；last 去重避免无谓的系统调用
  let last = -1;
  let syncRevision = 0;
  const sync = async (count: number) => {
    if (count === last) return;
    last = count;
    const revision = ++syncRevision;
    await applyBadge(count);
    // 图标与菜单查询都可能晚于下一次未读变化，只让最新同步继续写文案。
    if (revision !== syncRevision) return;
    try {
      await tray.setTooltip(
        count > 0
          ? `${i18next.t("tray.tooltip")} — ${unreadLabel(count)}`
          : i18next.t("tray.tooltip"),
      );
      const item = await menu.get("tray-unread");
      if (revision !== syncRevision) return;
      // Menu.get 返回的是基类，带 setText 的是 MenuItem；取不到就跳过
      if (item && "setText" in item)
        await (item as { setText(t: string): Promise<void> }).setText(unreadLabel(count));
    } catch (e) {
      console.warn("[tray] 更新托盘文案失败", e);
    }
  };

  void sync(selectTotalUnread(useConversationStore.getState().conversations));
  const unsub = useConversationStore.subscribe(
    (s) => void sync(selectTotalUnread(s.conversations)),
  );

  return () => {
    syncRevision += 1;
    unsub();
    void applyBadge(0);
    // fire-and-forget：id 唯一，即使与下一轮的创建乱序也只关自己
    void tray.close().catch(() => {});
  };
}
