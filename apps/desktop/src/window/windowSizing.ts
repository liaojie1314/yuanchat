/** 主窗口尺寸策略：Windows 按显示器逻辑工作区缩放，其他平台保持原尺寸。 */
interface Size {
  width: number;
  height: number;
}
interface MonitorArea {
  scaleFactor: number;
  workArea: { size: Size };
}

/** 把物理工作区按 DPI 折算；窗口和最小尺寸均不能越过可用区域。 */
export function windowSizing(
  platform: string,
  monitor?: MonitorArea | null,
): { main: Size; minimum: Size; login: Size } {
  const original = {
    main: { width: 1200, height: 800 },
    minimum: { width: 900, height: 600 },
    login: { width: 540, height: 640 },
  };
  if (
    platform !== "windows" ||
    !monitor ||
    !Number.isFinite(monitor.scaleFactor) ||
    monitor.scaleFactor <= 0
  )
    return original;
  const width = monitor.workArea.size.width / monitor.scaleFactor;
  const height = monitor.workArea.size.height / monitor.scaleFactor;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 32 || height <= 48)
    return original;
  // 最多缩到原尺寸八成；极小工作区另行夹紧，宁可使用响应式布局也不溢出屏幕。
  const factor = Math.max(0.8, Math.min(1, width / 1920, height / 1080));
  const fit = (size: Size): Size => ({
    width: Math.min(Math.round(size.width * factor), Math.floor(width - 32)),
    height: Math.min(Math.round(size.height * factor), Math.floor(height - 48)),
  });
  const main = fit(original.main);
  const minimum = fit(original.minimum);
  return {
    main,
    minimum: {
      width: Math.min(minimum.width, main.width),
      height: Math.min(minimum.height, main.height),
    },
    login: fit(original.login),
  };
}
