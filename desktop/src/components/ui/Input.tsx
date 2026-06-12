import { forwardRef, type InputHTMLAttributes } from "react";
import { clsx } from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={clsx(
            "input-base",
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
