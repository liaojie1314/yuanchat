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
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 错误提示文本，非空时输入框显示红色边框 */
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, type, ...props }, ref) => {
    const { t } = useTranslation();
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    return (
      <div className="w-full">
        <div className="relative">
          <input
            ref={ref}
            type={inputType}
            className={cn(
              "input-base",
              isPassword && "pr-10",
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
              {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
            </button>
          )}
        </div>
        {/*
         * 固定高度占位区（inline style 确保不受 Tailwind purge 影响）：
         * 有无错误文字时高度相同，表单卡片高度不变，m-auto 居中不跳动。
         */}
        <div style={{ minHeight: "1rem", marginTop: "0.25rem", marginLeft: "0.25rem" }}>
          {error && (
            <p className="text-error text-xs" style={{ lineHeight: "1rem" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  },
);

Input.displayName = "Input";
