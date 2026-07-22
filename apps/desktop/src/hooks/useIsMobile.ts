import { useState, useEffect } from "react";

/**
 * 检测是否在移动端环境（Android / iOS）
 *
 * 首帧通过 UA 同步检测避免闪烁，随后用 Tauri 原生 `platform()` API 修正，
 * 非 Tauri 环境静默回退到 UA 结果。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  );

  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/plugin-os")
      .then(({ platform }) => {
        if (!cancelled) {
          setIsMobile(platform() === "android" || platform() === "ios");
        }
      })
      .catch(() => {
        /* 非 Tauri 环境，保持 UA 检测结果 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return isMobile;
}
