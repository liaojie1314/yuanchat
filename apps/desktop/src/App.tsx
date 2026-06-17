import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { TitleBar } from "./components/TitleBar";
import { useIsMobile } from "./hooks/useIsMobile";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isMobile = useIsMobile();

  // 已认证时（含从持久化恢复的登录态）将窗口切换为首页尺寸
  useEffect(() => {
    if (!isAuthenticated) return;

    const resize = async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.setSize(new LogicalSize(1200, 800));
        await win.setResizable(true);
        await win.setMinSize(new LogicalSize(900, 600));
        await win.center();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    };
    resize();
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<MainLayout titleBar={isMobile ? undefined : <TitleBar />} />}>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
        <Route path="/contacts" element={<ChatPage />} />
        <Route path="/settings" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
