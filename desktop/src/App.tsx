import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { ChatPage } from "@/pages/ChatPage";
import { LoginPage } from "@/pages/LoginPage";

function App() {
  // TODO: 实际鉴权逻辑（Zustand store）
  const isAuthenticated = false;

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<MainLayout />}>
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
