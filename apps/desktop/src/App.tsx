import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { MainLayout, AppErrorBoundary, CloseBehaviorDialog } from "@yuanchat/ui";
import {
  setNotifier,
  setUrlOpener,
  useAuthStore,
  useConversationStore,
  useDesktopStore,
  useIsDesktop,
  useKeyboardAwareViewport,
  useMessageStore,
} from "@yuanchat/shared";
import { TitleBar } from "./components/TitleBar";
import { useIsMobile } from "./hooks/useIsMobile";
import { useCallWindow } from "./hooks/useCallWindow";
import {
  SEARCH_NAVIGATE_EVENT,
  useSearchWindow,
  type SearchNavigatePayload,
} from "./hooks/useSearchWindow";
import { EXIT_CONFIRM_MS, useAndroidBack } from "./hooks/useAndroidBack";
import { ExitHint } from "./components/ExitHint";

const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const ContactsPage = lazy(() =>
  import("./pages/ContactsPage").then((m) => ({ default: m.ContactsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })),
);
const QrLoginPage = lazy(() =>
  import("./pages/QrLoginPage").then((m) => ({ default: m.QrLoginPage })),
);
const FavoritesPage = lazy(() =>
  import("./pages/FavoritesPage").then((m) => ({ default: m.FavoritesPage })),
);
const MomentsPage = lazy(() =>
  import("./pages/MomentsPage").then((m) => ({ default: m.MomentsPage })),
);
const MomentComposePage = lazy(() =>
  import("./pages/MomentComposePage").then((m) => ({ default: m.MomentComposePage })),
);
const MomentActivitiesPage = lazy(() =>
  import("./pages/MomentActivitiesPage").then((m) => ({ default: m.MomentActivitiesPage })),
);
const MomentUserPage = lazy(() =>
  import("./pages/MomentUserPage").then((m) => ({ default: m.MomentUserPage })),
);
const StickersPage = lazy(() =>
  import("./pages/StickersPage").then((m) => ({ default: m.StickersPage })),
);
const StickerPackDetailPage = lazy(() =>
  import("./pages/StickerPackDetailPage").then((m) => ({ default: m.StickerPackDetailPage })),
);
const StickerPublishPage = lazy(() =>
  import("./pages/StickerPublishPage").then((m) => ({ default: m.StickerPublishPage })),
);
const StickerPackEditPage = lazy(() =>
  import("./pages/StickerPackEditPage").then((m) => ({ default: m.StickerPackEditPage })),
);
const StickerMinePage = lazy(() =>
  import("./pages/StickerMinePage").then((m) => ({ default: m.StickerMinePage })),
);
const CallWindowPage = lazy(() =>
  import("./pages/CallWindowPage").then((m) => ({ default: m.CallWindowPage })),
);
const SearchWindowPage = lazy(() =>
  import("./pages/SearchWindowPage").then((m) => ({ default: m.SearchWindowPage })),
);

// 模块级一次性注册：把原生「用系统应用打开」注入 shared 的外链抽象。
// WebView 里 window.open 是哑的（安卓上点「下载」毫无反应），必须交给系统浏览器。
// 走自定义命令 open_external 而不是 plugin-shell 的 JS open：后者在安卓上
// 根本不经过原生 Intent，必然失败（原因见 src-tauri/src/lib.rs 的 open_external）。
// 非 Tauri 环境（浏览器里跑本 bundle 做 dev）不注册，shared 自会回落 window.open。
if ("__TAURI_INTERNALS__" in window) {
  setUrlOpener((url) => invoke("open_external", { url }));
}

// 模块级一次性注册：权限就绪后把 Tauri 通知注入 shared 抽象
// （receive 帧只在主窗口出现，子窗口注册无害；非 Tauri 环境 catch 静默）
void (async () => {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      setNotifier((title, body) => sendNotification({ title, body }));
    }
  } catch {
    /* 非 Tauri 环境（浏览器 dev）忽略 */
  }
})();

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // 安卓系统返回键交由前端决定语义，见 useAndroidBack 的说明
  const exitHintSeq = useAndroidBack();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  // 通话窗口跑的是同一个 SPA：它自己就是承载方，不能再套一层开窗逻辑；
  // 移动端没有多窗口，通话走 MainLayout 里的浮层
  const { pathname } = useLocation();
  const isCallWindow = pathname === "/call";
  // 独立搜索窗口同理：搜索的承载方就是它自己（数据自拉、结果经事件桥出窗），
  // 不再注册开窗逻辑，也不安装托盘/不吃窗口尺寸复位（见下方三个 effect）
  const isSearchWindow = pathname === "/search-window";
  const isStandaloneWindow = isCallWindow || isSearchWindow;
  useCallWindow(!isMobile && !isStandaloneWindow);
  useSearchWindow(!isMobile && !isStandaloneWindow);

  // 移动端软键盘弹出时把内容顶起（桌面端 / 旧 WebView 自动降级为无操作）
  useKeyboardAwareViewport();

  // 关窗行为：默认每次询问；勾「记住」后写进 desktopStore（本机持久化），
  // 之后由设置页的三选开关给回头路
  const [askClose, setAskClose] = useState(false);
  const closeBehavior = useDesktopStore((s) => s.closeBehavior);
  const setCloseBehavior = useDesktopStore((s) => s.setCloseBehavior);

  /**
   * 关窗动作。
   *
   * @remarks 最小化到托盘要用 hide 而非 minimize：minimize 仍在任务栏占位，
   * 而「最小化到托盘」的本意是从任务栏消失、只留托盘图标。
   */
  const doClose = async (b: "tray" | "quit") => {
    try {
      if (b === "tray") {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
      } else {
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      }
    } catch {
      /* 非 Tauri 环境（浏览器 dev）忽略 */
    }
  };

  /** 点关闭按钮：偏好为 ask 时弹窗询问，其余直接执行记住的选择 */
  const handleClose = async () => {
    if (closeBehavior === "ask") {
      setAskClose(true);
      return;
    }
    await doClose(closeBehavior);
  };

  // 登录态驱动窗口形态：已认证 → 首页大窗可缩放；登出/未登录 → 恢复登录小窗不可缩放
  useEffect(() => {
    // 独立窗口（通话/搜索）不吃这套尺寸复位：label 检查在下面已兜底，
    // 这里显式挡掉是表明意图 —— 它们的尺寸归各自的宿主逻辑管
    if (isStandaloneWindow) return;
    const resize = async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        // 注册/忘记密码等子窗口跑的是同一个 SPA，此逻辑只归主窗口管，
        // 否则未登录分支会把子窗口压回 540×600（覆盖 openAuthWindow 指定的尺寸）
        if (win.label !== "main") return;
        if (isAuthenticated) {
          await win.setSize(new LogicalSize(1200, 800));
          await win.setResizable(true);
          await win.setMinSize(new LogicalSize(900, 600));
        } else {
          // 先清最小尺寸并退出最大化，否则 900×600 的 minSize 会卡住缩不回登录窗
          await win.unmaximize();
          await win.setMinSize(undefined);
          await win.setSize(new LogicalSize(540, 640));
          await win.setResizable(false);
        }
        await win.center();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    };
    void resize();
  }, [isAuthenticated, isStandaloneWindow]);

  // navigate 的函数身份随导航变化；进 effect 依赖会让每次切路由都卸装一次托盘
  // （顶栏短暂出现第二个图标）。走 ref 取最新值，effect 只认装/不装的条件。
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // 跨窗口导航桥（仅主窗口注册监听）：搜索窗口选中结果后 emit("search:navigate")，
  // 在这里落地。落在 App 而不是 MainLayout：桥的两端（emit 在 SearchWindowPage）
  // 都要碰 Tauri API，desktop 外壳是唯一不违反「ui 包不依赖 @tauri-apps/*」约定
  // 的位置，且 navigateRef 已经在这层为托盘建好了。
  //
  // setActive 必须在主窗口做（搜索窗口里的 store 是另一个 JS 上下文，动它无效）：
  // 会话视图由 conversationStore.activeId 驱动、ChatScreen 不消费 /chat/:id 路由
  // 参数，只 navigate 界面不会切换（托盘跳转踩过的同一个坑）。
  useEffect(() => {
    if (!isDesktop || isMobile || !isAuthenticated || isStandaloneWindow) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        // 搜索/通话/注册等子窗口跑的是同一个 bundle，桥只归 main 管
        if (cancelled || getCurrentWindow().label !== "main") return;
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<SearchNavigatePayload>(SEARCH_NAVIGATE_EVENT, (e) => {
          const { path, conversationId, seek } = e.payload;
          if (conversationId) useConversationStore.getState().setActive(conversationId);
          if (seek) {
            void useMessageStore
              .getState()
              .seekToMessage(seek.conversationId, seek.messageId, seek.seq);
          }
          navigateRef.current(path);
          // 搜索窗口关了自己之后焦点不一定自动回落（视窗口管理器而定），显式带回主窗口
          void getCurrentWindow()
            .setFocus()
            .catch(() => {});
        });
        // 异步竞态：装好前 effect 已清理（登出），直接退订不留悬空监听
        if (cancelled) unlisten();
        else dispose = unlisten;
      } catch {
        /* 非 Tauri 环境（浏览器 dev）忽略 */
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [isDesktop, isMobile, isAuthenticated, isStandaloneWindow]);

  // 托盘 + 系统未读角标：仅主窗口安装（桌面 app、已登录）。登出时本 effect
  // 的清理函数会卸掉托盘并清角标，否则登出后托盘还挂着旧账号的未读数
  useEffect(() => {
    if (!isDesktop || isMobile || !isAuthenticated || isStandaloneWindow) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        // 注册/忘记密码/通话等子窗口跑的是同一个 bundle，托盘只归 main 管
        if (cancelled || getCurrentWindow().label !== "main") return;
        const { installTray } = await import("./tray");
        const d = await installTray({
          onOpenConversation: (id) => {
            // null 表示没有未读：只聚焦窗口，不跳转 —— 否则会把用户正在看的位置顶掉。
            // 会话视图由 store 的 activeId 驱动（/chat/:id 的参数不被消费），
            // 只 navigate 不 setActive 的结果是 URL 变了界面纹丝不动
            if (id) {
              useConversationStore.getState().setActive(id);
              navigateRef.current(`/chat/${id}`);
            }
          },
        });
        // 异步竞态：安装完成前 effect 已清理（登出），直接走卸载而不是挂回去
        if (cancelled) d();
        else dispose = d;
      } catch {
        /* 非 Tauri 环境（浏览器 dev）忽略 */
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [isDesktop, isMobile, isAuthenticated, isStandaloneWindow]);

  if (!isAuthenticated) {
    return (
      <AppErrorBoundary>
        {exitHintSeq > 0 && (
          <ExitHint
            key={exitHintSeq}
            text={t("common.pressAgainToExit")}
            durationMs={EXIT_CONFIRM_MS}
          />
        )}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/qr-login" element={<QrLoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      {exitHintSeq > 0 && (
        <ExitHint
          key={exitHintSeq}
          text={t("common.pressAgainToExit")}
          durationMs={EXIT_CONFIRM_MS}
        />
      )}
      <Suspense fallback={null}>
        <Routes>
          {/* 独立通话窗口：不套 MainLayout —— 它自建 WebSocket 并整屏渲染 CallView */}
          <Route path="/call" element={<CallWindowPage />} />
          {/* 独立搜索窗口：不套 MainLayout —— 数据自拉，选中结果经事件桥回主窗口 */}
          <Route path="/search-window" element={<SearchWindowPage />} />
          <Route
            element={
              <MainLayout
                titleBar={isMobile ? undefined : <TitleBar onClose={handleClose} />}
                callMode={isMobile ? "overlay" : "window"}
              />
            }
          >
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            {/* 朋友圈：静态段（compose/activities）在 user/:userId 之前声明，同商城的顺序约定 */}
            <Route path="/moments" element={<MomentsPage />} />
            <Route path="/moments/compose" element={<MomentComposePage />} />
            <Route path="/moments/activities" element={<MomentActivitiesPage />} />
            <Route path="/moments/user/:userId" element={<MomentUserPage />} />
            {/* 静态段（publish/mine）须在 :packId 之前声明：React Router 静态段优先级
                更高，顺序书写仅为可读性——商城路由是本项目的 URL 列表→详情首例 */}
            <Route path="/stickers" element={<StickersPage />} />
            <Route path="/stickers/publish" element={<StickerPublishPage />} />
            <Route path="/stickers/mine" element={<StickerMinePage />} />
            <Route path="/stickers/:packId" element={<StickerPackDetailPage />} />
            <Route path="/stickers/:packId/edit" element={<StickerPackEditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        </Routes>
      </Suspense>
      {/* 关窗二选一弹窗：仅主窗口的 TitleBar 关闭按钮会唤起 */}
      <CloseBehaviorDialog
        open={askClose}
        onCancel={() => setAskClose(false)}
        onPick={(b, remember) => {
          setAskClose(false);
          if (remember) setCloseBehavior(b);
          void doClose(b);
        }}
      />
    </AppErrorBoundary>
  );
}

export default App;
