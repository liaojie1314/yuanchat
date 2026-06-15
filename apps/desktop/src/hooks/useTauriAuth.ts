import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * 桌面端认证窗口管理
 *
 * Tauri WebviewWindow API 在当前版本存在兼容性问题，
 * 暂时使用 React Router 导航替代。后续 Tauri API 稳定后再启用多窗口。
 */
export function useOpenAuthWindow() {
  const navigate = useNavigate();
  return useCallback(
    (route: string, _title: string) => {
      navigate(route);
    },
    [navigate],
  );
}

export function useCloseAuthWindow() {
  const navigate = useNavigate();
  return useCallback(() => {
    navigate("/chat", { replace: true });
  }, [navigate]);
}
