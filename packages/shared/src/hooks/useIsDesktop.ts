import { useState, useEffect } from "react";

/** 检测是否在 Tauri 桌面环境 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop("__TAURI_INTERNALS__" in window);
  }, []);
  return isDesktop;
}
