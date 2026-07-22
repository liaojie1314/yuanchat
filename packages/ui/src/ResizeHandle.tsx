import type { HTMLAttributes } from "react";

/**
 * 可拖拽列分隔手柄
 *
 * @description
 * 一个 4px 宽的可交互区域，hover 高亮，拖拽时变为主题色。
 * 搭配 `useResizable` hook 使用，实现多栏之间可拖拽调整宽度。
 *
 * @example
 * ```tsx
 * const { width, handleProps } = useResizable(260, 200, 400);
 * <div style={{ width }}>panel</div>
 * <ResizeHandle {...handleProps} />
 * ```
 */
export function ResizeHandle({
  isDragging,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { isDragging?: boolean }) {
  return (
    <div
      {...props}
      className={`relative w-1 shrink-0 cursor-col-resize transition-colors select-none ${isDragging ? "bg-primary" : "hover:bg-primary/40 bg-transparent"} ${className}`}
      // 扩大可点击区域（视觉 4px，实际可点击 8px）
      style={{
        marginLeft: -2,
        marginRight: -2,
        paddingLeft: 2,
        paddingRight: 2,
        ...props.style,
      }}
    />
  );
}
