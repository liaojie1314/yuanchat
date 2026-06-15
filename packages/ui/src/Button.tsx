/**
 * Button 组件 — 元聊设计系统的按钮组件
 *
 * @description
 * 提供 4 种视觉变体，覆盖 IM 场景中所有按钮需求：
 * - primary：主要操作（发送消息、登录、确认）
 * - secondary：次要操作（取消、返回）
 * - ghost：极简按钮（工具栏图标按钮）
 * - danger：危险操作（删除、退出群聊）
 *
 * 支持所有原生 `<button>` 属性（通过 `...props` 透传）。
 * 使用 `forwardRef` 支持外部传递 ref（用于焦点管理）。
 *
 * @param variant - 按钮变体，默认 "primary"
 * @param className - 外部附加的 Tailwind 类名（会与基础样式智能合并）
 * @param disabled - 禁用状态，自动降低透明度并禁用点击
 * @param children - 按钮内容（文字、图标或两者组合）
 *
 * @example
 * <Button variant="primary" onClick={handleSend}>发送</Button>
 * <Button variant="danger" disabled>删除</Button>
 */
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@yuanchat/shared/utils";

/** 按钮视觉变体类型 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体，控制颜色和风格 */
  variant?: ButtonVariant;
}

/** 各变体的 Tailwind 样式映射 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 shadow-sm",
  secondary:
    "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700",
  ghost:
    "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
  danger:
    "bg-error text-white hover:bg-red-600 active:bg-red-700 shadow-sm",
};

/**
 * 按钮组件
 *
 * forwardRef 允许父组件获取底层 `<button>` DOM 元素的引用。
 * 例如：父组件需要在按钮渲染后自动聚焦它。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // 基础布局：内联弹性盒，居中内容
          "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium",
          // 过渡动画：颜色变化 150ms
          "transition-colors duration-150",
          // 焦点环：蓝色半透明，不影响布局（outline 不占空间）
          "focus:outline-none focus:ring-2 focus:ring-primary-500/40",
          // 禁用态：半透明 + 禁止点击
          "disabled:opacity-50 disabled:cursor-not-allowed",
          // 变体样式：根据 variant 选择对应的颜色方案
          variantStyles[variant],
          // 外部传入的类名放在最后，允许覆盖默认样式
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  },
);

/** displayName 用于 React DevTools 中显示可读的组件名称 */
Button.displayName = "Button";
