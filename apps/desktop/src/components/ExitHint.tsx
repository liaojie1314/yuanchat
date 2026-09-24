/**
 * 退出确认提示（屏幕正中，无图标）
 *
 * @description
 * 安卓在底部标签页按返回键时的两段式退出提示：第一次只提示，窗口期内再按一次才真退出。
 * 刻意不复用 toastStore：那套是右上/底部的带图标通知，而这里要的是安卓原生
 * 「再按一次退出」那种屏幕正中的纯文字浮层，视觉语义完全不同。
 *
 * 纯展示组件，可见性由调用方（useAndroidBack）用 key 触发重挂来控制。
 */
import { useEffect, useState } from "react";

export interface ExitHintProps {
  /** 提示文案 */
  text: string;
  /** 自动消失时间，应与两段式确认的窗口期一致 */
  durationMs: number;
}

/**
 * 屏幕正中的退出提示浮层
 *
 * @param props - 见 {@link ExitHintProps}
 */
export function ExitHint({ text, durationMs }: ExitHintProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
    >
      <span className="rounded-lg bg-on-surface/80 px-4 py-2.5 text-sm text-surface">{text}</span>
    </div>
  );
}
