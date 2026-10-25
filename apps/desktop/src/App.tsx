import { lazy, Suspense, useEffect, useState } from "react";
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
  useDesktopStore,
  useIsDesktop,
  useKeyboardAwareViewport,
} from "@yuanchat/shared";
import { TitleBar } from "./components/TitleBar";
import { useIsMobile } from "./hooks/useIsMobile";
import { useCallWindow } from "./hooks/useCallWindow";
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
  const isCallWindow = useLocation().pathname === "/call";
  useCallWindow(!isMobile && !isCallWindow);

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
  }, [isAuthenticated]);

  // 托盘 + 系统未读角标：仅主窗口安装（桌面 app、已登录）。登出时本 effect
  // 的清理函数会卸掉托盘并清角标，否则登出后托盘还挂着旧账号的未读数
  useEffect(() => {
    if (!isDesktop || isMobile || !isAuthenticated || isCallWindow) return;
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
            // null 表示没有未读：只聚焦窗口，不跳转 —— 否则会把用户正在看的位置顶掉
            if (id) navigate(`/chat/${id}`);
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
  }, [isDesktop, isMobile, isAuthenticated, isCallWindow, navigate]);

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
