/**
 * useLongPress — 触屏长按手势
 *
 * @description
 * 长按呼出菜单在真机上有两个坑，桌面浏览器模拟触屏时都不会暴露，
 * 表现都是「菜单弹不出来」或者「闪一下就没了」：
 *
 * 1. 手指按住时不可能完全不动，「任何 touchmove 都取消长按」的写法在真机上
 *    几乎按不出菜单。这里改成位移超过 {@link MOVE_TOLERANCE} 才判定为滑动（滚列表）而取消。
 * 2. 抬手时浏览器会在长按目标上补发一整套合成鼠标事件（mousedown → mouseup → click），
 *    菜单的「点外部关闭」监听会把刚弹出的菜单立刻关掉。按固定「呼出时刻 + 时间窗」
 *    豁免并不够：按住 1 秒再抬手时窗口早已过期，菜单照样秒关。
 *    因此这里按手势状态判断——手指还按着，或抬手后 {@link SYNTHETIC_ECHO_WINDOW}
 *    毫秒内，{@link UseLongPressResult.isTouchEcho} 为真，关闭监听据此放行。
 *
 * 只有「确实呼出过菜单」的那次按压才算余波：随后落在别处（甚至另一个绑定了本手势的
 * 列表项）的新一次按压 isTouchEcho 为假，菜单照常关闭。
 *
 * @example
 * const { handlers, isTouchEcho } = useLongPress((x, y) => openMenuAt(x, y));
 * <li {...handlers} />
 * // 关闭监听里：if (isTouchEcho()) return;
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";

/** 判定为长按的按住时长（毫秒） */
const DEFAULT_DELAY = 500;
/** 按压期间允许的位移（像素）：超过即视为滑动，取消长按 */
const MOVE_TOLERANCE = 12;
/** 抬手后合成鼠标事件的豁免窗（毫秒），取够覆盖 mousedown → click 一整套 */
export const SYNTHETIC_ECHO_WINDOW = 400;

/** 绑定到目标元素的触屏事件处理器 */
export type LongPressHandlers = {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

export type UseLongPressResult = {
  /** 铺到目标元素上的触屏事件处理器（引用稳定，可安全展开在 JSX 上） */
  handlers: LongPressHandlers;
  /** 当前指针事件是否为长按余波（手指未抬起，或抬起后仍在豁免窗内） */
  isTouchEcho: () => boolean;
};

/**
 * @param open - 长按达成时的回调，参数为触点视口坐标；每次渲染可传新闭包，内部只调最新的一份
 * @param delay - 判定为长按的按住时长（毫秒）
 */
export function useLongPress(
  open: (x: number, y: number) => void,
  delay: number = DEFAULT_DELAY,
): UseLongPressResult {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** 本次按压是否已呼出（决定抬手后要不要给豁免窗） */
  const fired = useRef(false);
  /** 手指是否还在屏幕上 */
  const holding = useRef(false);
  /** 呼出过菜单的那次按压的抬手时刻 */
  const releasedAt = useRef(0);
  /** 最新的呼出回调：存进 ref，让 handlers 引用稳定而不必随回调重建 */
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  });

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // 卸载时清掉未触发的定时器，避免对已卸载组件 setState
  useEffect(() => clearTimer, [clearTimer]);

  const handlers = useMemo<LongPressHandlers>(() => {
    const release = () => {
      clearTimer();
      holding.current = false;
      // 只有呼出过菜单的按压才需要豁免窗：普通点击的合成事件本就该照常关闭菜单
      if (fired.current) releasedAt.current = Date.now();
    };
    return {
      onTouchStart: (e) => {
        const touch = e.touches[0];
        // 触点坐标必须当场取下：定时器触发时 e.touches 已清空
        const x = touch?.clientX ?? 0;
        const y = touch?.clientY ?? 0;
        origin.current = { x, y };
        holding.current = true;
        fired.current = false;
        clearTimer();
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          openRef.current(x, y);
        }, delay);
      },
      onTouchMove: (e) => {
        const touch = e.touches[0];
        const from = origin.current;
        if (!touch || !from) return;
        if (
          Math.abs(touch.clientX - from.x) > MOVE_TOLERANCE ||
          Math.abs(touch.clientY - from.y) > MOVE_TOLERANCE
        ) {
          clearTimer();
        }
      },
      onTouchEnd: release,
      onTouchCancel: release,
    };
  }, [clearTimer, delay]);

  const isTouchEcho = useCallback(
    () =>
      (holding.current && fired.current) || Date.now() - releasedAt.current < SYNTHETIC_ECHO_WINDOW,
    [],
  );

  return { handlers, isTouchEcho };
}
