import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout, AppErrorBoundary } from "@yuanchat/ui";
import { useAuthStore, useKeyboardAwareViewport } from "@yuanchat/shared";

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

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // 移动端浏览器软键盘弹出时把内容顶起（桌面浏览器自动降级为无操作）
  useKeyboardAwareViewport();

  if (!isAuthenticated) {
    return (
      <AppErrorBoundary>
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
      <Suspense fallback={null}>
        <Routes>
          <Route element={<MainLayout />}>
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
