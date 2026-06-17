/**
 * Input 组件 — 元聊设计系统的文本输入框
 *
 * @description
 * 统一的文本输入框组件，支持：
 * - 错误状态（显示红色边框 + 错误提示文本）
 * - 密码显隐切换（type="password" 时自动显示眼睛图标）
 * - 自动聚焦（通过 ref）
 * - 所有原生 input 属性透传（type、placeholder、onChange 等）
 *
 * 使用 `forwardRef` 支持外部传递 ref。
 * 样式由 `@yuanchat/design-system` 中的 `.input-base` 类提供。
 *
 * @param error - 错误提示文本，非空时显示错误样式和提示
 *
 * @example
 * <Input placeholder="请输入手机号" type="tel" />
 * <Input placeholder="密码" type="password" error="密码长度不足8位" />
 */
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@yuanchat/shared/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 错误提示文本，非空时输入框显示红色边框 */
  error?: string;
}

/**
 * 睁眼图标 — 密码明文可见
 *
 * 在一个 24×24 的画布上绘制简洁的眼睛图形，
 * 外轮廓 + 圆形瞳孔，表示「正在注视 / 明文可见」。
 */
function EyeOpenIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * 闭眼图标 — 密码密文隐藏
 *
 * 眼睛轮廓 + 自左上至右下的斜线，
 * 表示「不可见 / 密码隐藏」。
 */
function EyeClosedIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, type, ...props }, ref) => {
    const { t } = useTranslation();
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    // 当密码可见时显示明文，否则保持原始 type
    const inputType = isPassword && showPassword ? "text" : type;

    return (
      <div className="w-full">
        <div className="relative">
          <input
            ref={ref}
            type={inputType}
            className={cn(
              // input-base 由 @yuanchat/design-system 的 global.css 定义
              "input-base",
              // 密码框预留右侧图标空间
              isPassword && "pr-10",
              // 错误态：红色边框 + 红色聚焦环
              error && "border-error focus:ring-error/40 focus:border-error",
              className,
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={props.disabled}
              className="text-on-surface-variant hover:text-on-surface absolute top-1/2 right-3 -translate-y-1/2 p-0.5 disabled:opacity-40"
              tabIndex={-1}
              aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            >
              {/*
               * 状态导向：密码可见 → 睁眼（EyeOpenIcon）；密码隐藏 → 闭眼（EyeClosedIcon）
               * 点击切换显隐
               */}
              {showPassword ? <EyeOpenIcon size={20} /> : <EyeClosedIcon size={20} />}
            </button>
          )}
        </div>
        {error && <p className="text-error mt-1 ml-1 text-xs">{error}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
