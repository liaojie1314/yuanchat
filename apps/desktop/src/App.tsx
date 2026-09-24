import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { MainLayout, AppErrorBoundary } from "@yuanchat/ui";
import { setNotifier, useAuthStore, useKeyboardAwareViewport } from "@yuanchat/shared";
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
  // 通话窗口跑的是同一个 SPA：它自己就是承载方，不能再套一层开窗逻辑；
  // 移动端没有多窗口，通话走 MainLayout 里的浮层
  const isCallWindow = useLocation().pathname === "/call";
  useCallWindow(!isMobile && !isCallWindow);

  // 移动端软键盘弹出时把内容顶起（桌面端 / 旧 WebView 自动降级为无操作）
  useKeyboardAwareViewport();

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
                titleBar={isMobile ? undefined : <TitleBar />}
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
    </AppErrorBoundary>
  );
}

export default App;
