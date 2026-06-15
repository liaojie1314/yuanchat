/**
 * useIsDesktop — 检测当前是否运行在 Tauri 桌面环境中
 *
 * @description
 * 通过检查 window.__TAURI_INTERNALS__ 来判断。
 * Tauri 2 在运行时注入此全局对象，Web 端不存在。
 *
 * @returns true 表示运行在 Tauri 桌面应用
 */
import { useState, useEffect } from "react";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop("__TAURI_INTERNALS__" in window);
  }, []);

  return isDesktop;
}
