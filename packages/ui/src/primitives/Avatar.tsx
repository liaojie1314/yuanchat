/**
 * Avatar 组件 — 用户头像（含在线状态指示）
 *
 * @description
 * 基于 Radix UI Avatar 原语构建，支持：
 * - 图片头像：加载成功时显示图片
 * - 文字头像：图片加载失败或未提供时，显示用户名的前两个字符
 * - 在线状态：右下角圆点指示，四种 presence（在线/离开/忙碌/离线）
 * - 个人状态：右下角 emoji 角标（K11），与 presence 圆点同位、状态优先
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
  /**
   * 个人状态 emoji（K11）：渲染在头像右下角的小圆底上，空串/未传不渲染。
   *
   * @remarks 与 presence 圆点**同一个位置，二者只显示一个，状态优先**。
   *   两个都画会在 32px 头像上叠成一团糊；「在线」这类信息用户还能从
   *   会话列表与聊天页副标题拿到，而自定义状态只有这一处出口。
   *   群头像（GroupAvatar）没有这个角标：状态是人的属性，群没有状态。
   */
  statusEmoji?: string;
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

/**
 * 状态 emoji 角标尺寸随头像缩放。
 *
 * 用方括号像素值而非 rem 刻度：本仓 root font-size 是 14px，h-4 实际只有 14px，
 * 装不住一个 emoji；宽高写死成正方形也避免用 aspect-ratio（旧 WebView 会塌成 0 高）。
 */
const statusSizeMap = {
  sm: "h-[16px] w-[16px] text-[9px]",
  md: "h-[18px] w-[18px] text-[11px]",
  lg: "h-[22px] w-[22px] text-[13px]",
  xl: "h-[26px] w-[26px] text-[15px]",
};

/** presence → 语义色（与原型 --online/--away/--busy/--offline 一致） */
const presenceColorMap: Record<Presence, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  busy: "bg-red-500",
  offline: "bg-neutral-300 dark:bg-neutral-600",
};

export function Avatar({ src, name, size = "md", online, presence, statusEmoji }: AvatarProps) {
  // 提取用户名的前两个字符作为头像文字（如 "张三" → "张三"）
  const initials = name.slice(0, 2).toUpperCase();
  // 基于用户名哈希的稳定随机背景色
  const bgColor = getAvatarColor(name);
  // presence 优先；仅传 online 时映射为 online/offline
  const dot: Presence | undefined =
    presence ?? (online === undefined ? undefined : online ? "online" : "offline");
  // 状态角标占住右下角时不再画 presence 圆点（同位置只留一个）
  const showStatus = !!statusEmoji;

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

      {/* 个人状态角标：表面色圆底 + 细边，保证任何头像底色上都看得清 */}
      {showStatus && (
        <span
          className={cn(
            "border-outline-variant bg-surface absolute -right-1 -bottom-1 inline-flex items-center justify-center rounded-full border leading-none",
            statusSizeMap[size],
          )}
        >
          {statusEmoji}
        </span>
      )}

      {/* 状态指示：右下角小圆点，带表面色边框确保任何背景下可见 */}
      {!showStatus && dot && (
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
