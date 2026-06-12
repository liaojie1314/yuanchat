import { type ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium",
          "transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary-500/40",
          "disabled:opacity-50 disabled:cursor-not-allowed",
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

Button.displayName = "Button";
