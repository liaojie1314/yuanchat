import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn } from "@yuanchat/shared/utils";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
};

export function Avatar({ src, name, size = "md", online }: AvatarProps) {
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="relative inline-flex shrink-0">
      <RadixAvatar.Root
        className={cn(
          "rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/40",
          sizeMap[size],
        )}
      >
        {src && (
          <RadixAvatar.Image
            className="w-full h-full object-cover"
            src={src}
            alt={name}
          />
        )}
        <RadixAvatar.Fallback className="flex items-center justify-center w-full h-full text-primary-600 dark:text-primary-300 font-medium">
          {initials}
        </RadixAvatar.Fallback>
      </RadixAvatar.Root>

      {/* 在线状态指示 */}
      {online !== undefined && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900",
            online ? "bg-success" : "bg-neutral-300 dark:bg-neutral-600",
          )}
        />
      )}
    </div>
  );
}
