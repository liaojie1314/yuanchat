/** 窗口尺寸策略：Windows 高 DPI 按工作区折算，其余桌面平台保持原尺寸。 */
import { expect, it } from "vitest";
import { windowSizing } from "../window/windowSizing";

it("Windows 2560×1440 的 150% 缩放不会继续占用 1200×800 逻辑像素", () => {
  const sizes = windowSizing("windows", {
    scaleFactor: 1.5,
    workArea: { size: { width: 2560, height: 1440 } },
  });
  expect(sizes.main).toEqual({ width: 1067, height: 711 });
  expect(sizes.minimum).toEqual({ width: 800, height: 533 });
  expect(sizes.login).toEqual({ width: 480, height: 569 });
});
it.each(["linux", "macos"])("%s 保持现有尺寸，不被 Windows 修法影响", (platform) => {
  expect(
    windowSizing(platform, { scaleFactor: 2, workArea: { size: { width: 1920, height: 1080 } } }),
  ).toEqual({
    main: { width: 1200, height: 800 },
    minimum: { width: 900, height: 600 },
    login: { width: 540, height: 640 },
  });
});
it("Windows 小工作区会夹紧窗口及最小尺寸，不越过可用区域", () => {
  const sizes = windowSizing("windows", {
    scaleFactor: 1,
    workArea: { size: { width: 800, height: 600 } },
  });
  expect(sizes.main).toEqual({ width: 768, height: 552 });
  expect(sizes.minimum).toEqual({ width: 720, height: 480 });
});
it("拿不到有效工作区时按原尺寸安全回落", () => {
  expect(windowSizing("windows").main).toEqual({ width: 1200, height: 800 });
  expect(
    windowSizing("windows", { scaleFactor: 0, workArea: { size: { width: 2560, height: 1440 } } })
      .main,
  ).toEqual({ width: 1200, height: 800 });
});
