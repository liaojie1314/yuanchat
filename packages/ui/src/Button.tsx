import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@yuanchat/shared/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm",
  secondary: "bg-surface-100 text-slate-700 hover:bg-surface-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
  ghost: "text-slate-600 hover:bg-surface-100 dark:text-slate-300 dark:hover:bg-slate-700",
  danger: "bg-red-500 text-white hover:bg-red-600 active:bg-red-700 shadow-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, disabled, children, ...props }, ref) => {
    return (
      <button ref={ref} disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-body-md font-medium",
          "transition-colors duration-150",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variantStyles[variant],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
