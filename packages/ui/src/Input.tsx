/**
 * Input 组件 — 元聊设计系统的文本输入框
 *
 * @description
 * 统一的文本输入框组件，支持：
 * - 错误状态（显示红色边框 + 错误提示文本）
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
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@yuanchat/shared/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 错误提示文本，非空时输入框显示红色边框 */
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={cn(
            // input-base 由 @yuanchat/design-system 的 global.css 定义
            "input-base",
            // 错误态：红色边框 + 红色聚焦环
            error && "border-error focus:ring-error/40 focus:border-error",
            className,
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-error">{error}</p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
