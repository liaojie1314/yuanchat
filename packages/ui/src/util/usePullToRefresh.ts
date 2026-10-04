/**
 * usePullToRefresh — 触屏下拉刷新手势
 *
 * @description
 * 三个真机坑，桌面浏览器模拟触屏时都看不到：
 *
 * 1. **容器必须 `overscroll-behavior-y: contain`**（{@link PullToRefresh} 已带）。
 *    否则列表拉到顶再下拉会被浏览器自带的下拉刷新接管，手势永远落不到本 hook ——
 *    安卓 Chrome / WebView 上表现是整页重载而不是刷新列表。
 * 2. 刻意**不调 `preventDefault()`**：React 把 touchmove 注册成 passive 监听，
 *    调了只会在控制台报 "Unable to preventDefault inside passive event listener"
 *    而毫无效果。拦住原生滚动靠的是 ① 的 `contain` 加「仅 scrollTop 为 0 才进手势」。
 * 3. 手势位移走 ref 而非 state：抬手回调里要读「刚才拉了多远」，靠 state 闭包得赌
 *    这一帧已经重渲染完，快速下拉时会读到旧值。state 只负责渲染指示器。
 *
 * 门控只认 `pointer: coarse`：鼠标设备没有下拉刷新的交互概念，返回空 handlers
 * 让桌面端完全不挂监听。
 *
 * @example
 * const { handlers, distance, refreshing } = usePullToRefresh(loadConversations);
 * <div {...handlers} className="overscroll-y-contain overflow-y-auto">…</div>
 */
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { showToast } from "@yuanchat/shared";
import { useTranslation } from "react-i18next";

/** 触发刷新的下拉阈值（像素，已阻尼后的视觉距离） */
export const PULL_THRESHOLD = 64;
/** 阻尼系数：手指位移乘这个值才是指示器下移距离，拉起来有"拽"的手感 */
const DAMPING = 0.4;
/** 指示器最大下移距离，拉到底就不再跟手 */
const MAX_PULL = 96;

/** 铺到滚动容器上的触屏事件处理器；非触屏设备为空对象 */
export type PullHandlers = Partial<{
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}>;

export type UsePullToRefreshResult = {
  /** 展开到滚动容器上的事件处理器 */
  handlers: PullHandlers;
  /** 指示器当前下移距离（像素），0 表示不在手势中 */
  distance: number;
  /** 是否正在刷新 */
  refreshing: boolean;
};

/** 当前设备是否为触屏（粗指针）。`matchMedia` 缺失（jsdom / 老 WebView）按非触屏算 */
function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * @param onRefresh - 刷新回调，复用各屏已有的 load 函数即可；reject 会弹 toast 并收起指示器
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>): UsePullToRefreshResult {
  const { t } = useTranslation();
  const [coarse] = useState(isCoarsePointer);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  /** 手势起点 Y；null 表示未进手势（容器没在顶部，或已退出） */
  const startY = useRef<number | null>(null);
  /** 当前下拉距离的权威值，抬手时读它 */
  const pulled = useRef(0);
  /** 刷新中标志，拦住二次下拉；不用 state 以免闭包读到旧值 */
  const busy = useRef(false);
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  });

  if (!coarse) return { handlers: {}, distance: 0, refreshing: false };

  const reset = () => {
    startY.current = null;
    pulled.current = 0;
    setDistance(0);
  };

  const handlers: PullHandlers = {
    onTouchStart: (e) => {
      if (busy.current) return;
      // 只有列表已经在顶部才进手势，否则这一下是普通滚动
      startY.current = e.currentTarget.scrollTop === 0 ? (e.touches[0]?.clientY ?? null) : null;
    },
    onTouchMove: (e) => {
      const from = startY.current;
      const y = e.touches[0]?.clientY;
      if (from === null || y === undefined) return;
      const delta = y - from;
      // 反手往上拖 → 用户是要滚列表，退出手势
      if (delta <= 0) {
        reset();
        return;
      }
      pulled.current = Math.min(delta * DAMPING, MAX_PULL);
      setDistance(pulled.current);
    },
    onTouchEnd: () => {
      const reached = pulled.current >= PULL_THRESHOLD;
      startY.current = null;
      pulled.current = 0;
      if (!reached || busy.current) {
        setDistance(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      // 刷新期间指示器停在阈值处转圈，不跟着手指回弹
      setDistance(PULL_THRESHOLD);
      void refreshRef
        .current()
        .catch(() => showToast("error", t("common.opFailed")))
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
          setDistance(0);
        });
    },
    onTouchCancel: reset,
  };

  return { handlers, distance, refreshing };
}
