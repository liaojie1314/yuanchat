import { useState, useCallback, useEffect } from "react";

/**
 * 可拖拽调整宽度的面板 Hook
 *
 * @param initialWidth - 初始宽度（px）
 * @param minWidth - 最小宽度限制
 * @param maxWidth - 最大宽度限制
 *
 * @returns [width, handleProps]
 *   - width: 当前面板宽度
 *   - onMouseDown: 绑定到拖拽手柄的 mousedown 事件
 *   - isDragging: 是否正在拖拽中
 *
 * @example
 * ```tsx
 * const { width, handleProps, isDragging } = useResizable(260, 200, 400);
 * return (
 *   <>
 *     <div style={{ width }}>panel</div>
 *     <div {...handleProps} className="resize-handle" />
 *   </>
 * );
 * ```
 */
export function useResizable(initialWidth: number, minWidth: number = 180, maxWidth: number = 480) {
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      setWidth((prev) => {
        const next = prev + e.movementX;
        return Math.min(Math.max(next, minWidth), maxWidth);
      });
    };

    const onMouseUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    // 拖拽时禁止文本选中和 iframe 穿透
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, minWidth, maxWidth]);

  return {
    width,
    handleProps: { onMouseDown },
    isDragging,
  };
}
