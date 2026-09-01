/**
 * Admin App — 路由 + 鉴权守卫
 *
 * 未登录 → /login；已登录但非 admin 的账号在登录时即被拦截
 * （Login 页校验 role），运行期后端 RequireAdmin 二次兜底（403）。
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@yuanchat/shared";
import { AdminLayout } from "./components/AdminLayout";
import { LoginPage } from "./pages/Login";
import { UsersPage } from "./pages/Users";
import { ConversationsPage } from "./pages/Conversations";
import { MessageAuditPage } from "./pages/MessageAudit";
import { ModerationQueuePage } from "./pages/ModerationQueue";
import { StickerPacksPage } from "./pages/StickerPacks";
import { AuditLogsPage } from "./pages/AuditLogs";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route path="/users" element={<UsersPage />} />
        <Route path="/conversations" element={<ConversationsPage />} />
        <Route path="/messages" element={<MessageAuditPage />} />
        <Route path="/moderation" element={<ModerationQueuePage />} />
        <Route path="/sticker-packs" element={<StickerPacksPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Route>
    </Routes>
  );
}
