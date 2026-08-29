/**
 * 安卓系统返回键接线（仅移动端有意义）
 *
 * @description
 * 原生侧（MainActivity）把返回键委托给 `window.__androidBack__`，本 hook 负责实现它：
 * 先问拦截器（弹窗、扫码流程、移动端内部栈），没人处理再按路由判断，
 * 已在底部标签栏的任一根页面时按「再按一次退出」的两段式确认收尾。
 *
 * 返回**必须同步**：原生侧要拿返回值决定是否 finish Activity。
 *
 * 刻意不用 `navigate(-1)`：本应用的重定向大量使用 `replace`，history 里往往没有可回退的条目，
 * `navigate(-1)` 会静默无效。非根页面直接回到聊天页，行为确定。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { runBackInterceptors, useAuthStore } from "@yuanchat/shared";

/** 挂在 window 上供原生侧调用的返回处理器 */
interface AndroidBackWindow {
  __androidBack__?: () => boolean;
}

/**
 * 底部标签栏对应的根页面
 *
 * 在这些页面按返回键应当退出应用，而不是相互跳转 —— 它们是平级的一级入口，
 * 「从设置返回到聊天」并不是用户按返回键时期待的行为。
 */
const TAB_ROOTS = ["/chat", "/contacts", "/favorites", "/settings"];

/** 两次返回键之间的确认窗口，与提示浮层的存活时间一致 */
export const EXIT_CONFIRM_MS = 2000;

/**
 * 接管安卓返回键
 *
 * @returns 退出提示的触发序号：每次需要显示提示时递增，0 表示尚未提示过。
 *   调用方把它作为提示组件的 key，即可让同一提示重复出现。
 * @remarks 只需在应用根组件挂一次。桌面端挂了也无副作用（没有原生侧调用它）。
 */
export function useAndroidBack(): number {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  /** 上一次在根页面按返回键的时间戳，用于两段式退出确认 */
  const lastExitPressRef = useRef(0);
  const [hintSeq, setHintSeq] = useState(0);

  const showHint = useCallback(() => setHintSeq((n) => n + 1), []);

  useEffect(() => {
    const w = window as AndroidBackWindow;
    w.__androidBack__ = () => {
      // 弹窗 / 相机 / 组件内部栈优先，它们在视觉上盖在页面之上
      if (runBackInterceptors()) return true;

      const path = location.pathname;
      const atTabRoot = isAuthenticated
        ? TAB_ROOTS.includes(path)
        : path === "/login" || path === "/";

      if (!atTabRoot) {
        navigate(isAuthenticated ? "/chat" : "/login");
        return true;
      }

      // 根页面：第一次按返回只提示，窗口期内再按一次才真的退出
      const now = Date.now();
      if (now - lastExitPressRef.current > EXIT_CONFIRM_MS) {
        lastExitPressRef.current = now;
        showHint();
        return true;
      }
      lastExitPressRef.current = 0;
      return false;
    };

    return () => {
      delete w.__androidBack__;
    };
  }, [navigate, location.pathname, isAuthenticated, showHint]);

  return hintSeq;
}
