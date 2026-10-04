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
/**
 * M3 按钮变体样式 — 使用 CSS 变量支持皮肤切换。
 *
 * hover 一律改变**底色**而不只是抬高阴影：弹窗面板自带 `shadow-xl`，
 * 阴影再抬一级肉眼分辨不出，用户的直接反馈就是「鼠标放上去没有交互」。
 * ghost 的 hover 底色用 container-high 而非 container-low —— 后者与弹窗面板同色，
 * 等于没有 hover。
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-on shadow-elevation-1 hover:bg-primary/90 hover:shadow-elevation-2 active:shadow-none",
  secondary:
    "bg-surface-container-low text-on-surface hover:bg-surface-container-high border border-outline-variant",
  ghost: "text-on-surface hover:bg-surface-container-high",
  danger:
    "bg-error text-error-on shadow-elevation-1 hover:bg-error/90 hover:shadow-elevation-2 active:shadow-none",
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
          "text-label-lg inline-flex items-center justify-center rounded-lg px-6 py-3 font-medium",
          "transition-all duration-200",
          // ring 是 box-shadow，不占布局；offset 用透明色让缝隙透出所在面板的底色，
          // 否则默认白色 offset 在深色皮肤下会描出一圈白边。
          // 只挂 focus-visible 不动 focus：旧 WebView 不认这个伪类 → 整条规则作废，
          // 原生 outline 留作兜底，键盘用户不会失去焦点提示。
          "focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-[0.38]",
          variantStyles[variant],
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
