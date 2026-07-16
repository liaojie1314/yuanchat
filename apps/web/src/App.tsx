import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "@yuanchat/ui";
import { useAuthStore, useKeyboardAwareViewport } from "@yuanchat/shared";
import { ChatPage } from "./pages/ChatPage";
import { ContactsPage } from "./pages/ContactsPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { QrLoginPage } from "./pages/QrLoginPage";

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // 移动端浏览器软键盘弹出时把内容顶起（桌面浏览器自动降级为无操作）
  useKeyboardAwareViewport();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/qr-login" element={<QrLoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/settings" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
