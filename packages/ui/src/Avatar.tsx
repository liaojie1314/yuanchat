/**
 * Avatar 组件 — 用户头像（含在线状态指示）
 *
 * @description
 * 基于 Radix UI Avatar 原语构建，支持：
 * - 图片头像：加载成功时显示图片
 * - 文字头像：图片加载失败或未提供时，显示用户名的前两个字符
 * - 在线状态：右下角圆点指示，四种 presence（在线/离开/忙碌/离线）
 * - 四种尺寸：sm(32px)、md(40px)、lg(56px)、xl(64px)
 *
 * Radix Avatar 提供：
 * - Image 加载失败时自动切换到 Fallback
 * - 无障碍支持（aria-label）
 *
 * @param src - 头像图片 URL，null/undefined 时直接显示首字母
 * @param name - 用户名，用于生成首字母和 alt 文本
 * @param size - 尺寸，默认 "md"（40px）
 * @param online - 在线状态（布尔简写，等价 presence="online"/"offline"）
 * @param presence - 细分在线状态，优先级高于 online
 *
 * @example
 * <Avatar name="张三" src="https://..." online={true} size="md" />
 * <Avatar name="李四" presence="away" /> // 琥珀色离开状态点
 */
import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn, getAvatarColor } from "@yuanchat/shared/utils";
import type { Presence } from "@yuanchat/shared";

interface AvatarProps {
  /** 头像图片 URL */
  src?: string | null;
  /** 用户名，用于生成首字母 */
  name: string;
  /** 尺寸 */
  size?: "sm" | "md" | "lg" | "xl";
  /** 在线状态（布尔简写），undefined 时不显示 */
  online?: boolean;
  /** 细分在线状态，设置后覆盖 online */
  presence?: Presence;
}

/** 尺寸 → Tailwind 宽高/字号 映射 */
const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
  xl: "w-16 h-16 text-xl",
};

/** 状态点尺寸随头像缩放 */
const dotSizeMap = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
  xl: "h-4 w-4",
};

/** presence → 语义色（与原型 --online/--away/--busy/--offline 一致） */
const presenceColorMap: Record<Presence, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  busy: "bg-red-500",
  offline: "bg-neutral-300 dark:bg-neutral-600",
};

export function Avatar({ src, name, size = "md", online, presence }: AvatarProps) {
  // 提取用户名的前两个字符作为头像文字（如 "张三" → "张三"）
  const initials = name.slice(0, 2).toUpperCase();
  // 基于用户名哈希的稳定随机背景色
  const bgColor = getAvatarColor(name);
  // presence 优先；仅传 online 时映射为 online/offline
  const dot: Presence | undefined =
    presence ?? (online === undefined ? undefined : online ? "online" : "offline");

  return (
    <div className="relative inline-flex shrink-0">
      <RadixAvatar.Root
        className={cn("inline-flex overflow-hidden rounded-full", sizeMap[size])}
        style={{ backgroundColor: bgColor }}
      >
        {/* 仅当 src 存在时才渲染 Image，否则直接显示 Fallback */}
        {src && <RadixAvatar.Image className="h-full w-full object-cover" src={src} alt={name} />}
        <RadixAvatar.Fallback className="flex h-full w-full items-center justify-center font-medium text-white">
          {initials}
        </RadixAvatar.Fallback>
      </RadixAvatar.Root>

      {/* 状态指示：右下角小圆点，带表面色边框确保任何背景下可见 */}
      {dot && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-white dark:border-neutral-900",
            dotSizeMap[size],
            presenceColorMap[dot],
          )}
        />
      )}
    </div>
  );
}
