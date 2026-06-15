/**
 * Avatar 组件 — 用户头像（含在线状态指示）
 *
 * @description
 * 基于 Radix UI Avatar 原语构建，支持：
 * - 图片头像：加载成功时显示图片
 * - 文字头像：图片加载失败或未提供时，显示用户名的前两个字符
 * - 在线状态：右下角圆点指示（绿色=在线，灰色=离线）
 * - 三种尺寸：sm(32px)、md(40px)、lg(56px)
 *
 * Radix Avatar 提供：
 * - Image 加载失败时自动切换到 Fallback
 * - 无障碍支持（aria-label）
 *
 * @param src - 头像图片 URL，null/undefined 时直接显示首字母
 * @param name - 用户名，用于生成首字母和 alt 文本
 * @param size - 尺寸，默认 "md"（40px）
 * @param online - 在线状态，undefined 时不显示指示器
 *
 * @example
 * <Avatar name="张三" src="https://..." online={true} size="md" />
 * <Avatar name="李四" /> // 显示 "李四" 首字母，无在线状态
 */
import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn } from "@yuanchat/shared/utils";

interface AvatarProps {
  /** 头像图片 URL */
  src?: string | null;
  /** 用户名，用于生成首字母 */
  name: string;
  /** 尺寸 */
  size?: "sm" | "md" | "lg";
  /** 在线状态，undefined 时不显示 */
  online?: boolean;
}

/** 尺寸 → Tailwind 宽高/字号 映射 */
const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
};

export function Avatar({ src, name, size = "md", online }: AvatarProps) {
  // 提取用户名的前两个字符作为头像文字（如 "张三" → "张三"）
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="relative inline-flex shrink-0">
      <RadixAvatar.Root
        className={cn(
          "bg-primary-100 dark:bg-primary-900/40 overflow-hidden rounded-full",
          sizeMap[size],
        )}
      >
        {/* 仅当 src 存在时才渲染 Image，否则直接显示 Fallback */}
        {src && <RadixAvatar.Image className="h-full w-full object-cover" src={src} alt={name} />}
        <RadixAvatar.Fallback className="text-primary-600 dark:text-primary-300 flex h-full w-full items-center justify-center font-medium">
          {initials}
        </RadixAvatar.Fallback>
      </RadixAvatar.Root>

      {/* 在线状态指示：右下角小圆点，带白色边框确保可见 */}
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-neutral-900",
            online ? "bg-success" : "bg-neutral-300 dark:bg-neutral-600",
          )}
        />
      )}
    </div>
  );
}
