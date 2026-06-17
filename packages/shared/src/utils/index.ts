/**
 * 元聊通用工具函数集
 *
 * @description 提供跨平台共享的纯函数工具，不依赖任何平台特定 API。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind CSS 类名，自动处理样式冲突
 *
 * @description
 * 将 `clsx`（条件类名合并）和 `tailwind-merge`（Tailwind 冲突解决）组合使用。
 * 这是构建组件时最常用的工具函数，相当于一个"智能版 classnames"。
 *
 * 工作原理：
 * 1. `clsx` 接收任意数量的类名参数（字符串/对象/数组），过滤掉 falsy 值后合并
 * 2. `twMerge` 检查合并后的类名列表，当两个类名冲突时保留后出现的（如 `px-4 px-6` → `px-6`）
 *
 * @param inputs - 任意数量的类名参数，支持字符串、对象、数组
 * @returns 合并后的字符串，无冲突的 Tailwind 类名
 *
 * @example
 * cn("text-sm", "font-bold");                        // "text-sm font-bold"
 * cn("px-4", false && "hidden", "px-6");             // "px-6"（px-4 被覆盖）
 * cn("flex", { "bg-red-500": isError });             // 条件类名
 * cn(className, "additional-class");                 // 合并外部传入的 className
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 格式化时间为 IM 聊天场景的显示文本
 *
 * @description
 * 根据时间距离现在的远近来决定显示格式：
 * - 今天内：显示时:分（如 "14:32"）
 * - 昨天：显示 "昨天"
 * - 今年内：显示月日（如 "6月12日"）
 * - 更早：显示完整日期（如 "2025年6月12日"）
 *
 * @param date - Date 对象或 ISO 字符串
 * @returns 格式化后的时间文本
 *
 * @example
 * formatTime(new Date());              // "14:32"
 * formatTime("2026-06-11T10:00:00Z");  // "昨天"
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = diff / (1000 * 60 * 60);

  if (hours < 24 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } else if (hours < 48) {
    return "昨天";
  } else if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * 截断过长文本，超出长度时添加省略号
 *
 * @param text - 原始文本
 * @param maxLength - 最大字符数
 * @returns 截断后的文本，超出部分用 "…" 替代
 *
 * @example
 * truncate("这是一条很长很长很重要的消息", 8); // "这是一条很长很…"
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

// 表单校验
export {
  validatePassword,
  validateYuanchatId,
  validatePhone,
  validateNickname,
} from "./validation";
export type { ValidationResult } from "./validation";
