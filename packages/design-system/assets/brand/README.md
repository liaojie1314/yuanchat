# 品牌图形源文件

应用图标的**唯一来源**。`.design/` 是 gitignore 的草稿目录，正式源文件放这里。

| 文件                              | 用途                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app-icon.svg`                    | 完整图标（品牌渐变圆角方底 + 白气泡 + 镂空「元」），1024×1024                                                                    |
| `app-icon-android-foreground.svg` | Android 自适应图标的**前景层**：只有气泡，「元」是透明孔，整体缩到画布 62%（自适应图标只保证中心 72/108 ≈ 66% 不被系统遮罩裁掉） |

图形与 `packages/ui/src/primitives/BrandMark.tsx`（应用内 logo）是同一套路径，
改了一处就要同步另一处 —— 否则启动器里和登录页上会是两个不同的标识。

## 重新生成全套图标

本机没有 SVG 光栅化工具（无 rsvg-convert / cairosvg），用 Playwright 自带的
Chromium 截图。**注意 SVG 带固有尺寸 1024，浏览器不会把它缩到视口**，
所以必须以 1024 视口渲染后再用 PIL 缩放，否则只会截到左上角一块。

```bash
# 1) 渲染 1024 母图（在 apps/web 下执行，@playwright/test 装在那里）
cd apps/web && PLAYWRIGHT_BROWSERS_PATH=~/env/playwright node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.goto("file:///<仓库>/packages/design-system/assets/brand/app-icon.svg");
  await p.screenshot({ path: "/tmp/icon-1024.png", omitBackground: true });
  await b.close();
})();'

# 2) 生成桌面/iOS/Android 全套（会覆盖 src-tauri/icons 与 gen/android 的 mipmap）
cd apps/desktop && pnpm exec tauri icon /tmp/icon-1024.png
```

`tauri icon` 生成的 Android 前景层是**整张图**（自带背景），会被系统遮罩裁成一团。
因此第 2 步之后必须手工覆盖：把 `app-icon-android-foreground.svg` 渲成 1024 再缩到
108/162/216/324/432 覆盖各 `mipmap-*/ic_launcher_foreground.png`，并保留本仓已改好的
`drawable/ic_launcher_background.xml`（品牌渐变）与 `mipmap-anydpi-v26/*.xml`。
