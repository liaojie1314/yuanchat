import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

const version = JSON.parse(readFileSync("./package.json", "utf-8")).version as string;

export default defineConfig({
  plugins: [
    react(),
    // PWA：仅生产构建注入 Service Worker。
    // dev 下不启用——MSW 的 mockServiceWorker.js 同样注册在根 scope，
    // 两个 SW 会互相顶掉导致 mock 拦截失效。
    VitePWA({
      registerType: "autoUpdate",
      // injectManifest：用自定义 SW（含 Web Push 监听），
      // 预缓存清单由构建期注入 self.__WB_MANIFEST
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "service-worker.ts",
      // 已有 public/manifest.json 由本插件接管生成 manifest.webmanifest
      manifest: {
        name: "元聊 YuanChat",
        lang: "zh-CN",
        short_name: "元聊",
        description: "企业级即时通讯软件",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#f8f9fa",
        theme_color: "#4a7cc4",
        icons: [
          { src: "/yuanchat-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "maskable any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable any" },
        ],
        shortcuts: [
          { name: "消息", url: "/chat" },
          { name: "通讯录", url: "/contacts" },
        ],
      },
      injectManifest: {
        // app shell 预缓存；MSW worker 不入缓存（dev 专用）
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/mockServiceWorker.js"],
      },
      devOptions: { enabled: false },
    }),
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG || "",
          project: process.env.SENTRY_PROJECT_WEB || "",
          release: { name: version },
          sourcemaps: { assets: "dist/**" },
          telemetry: false,
        })
      : null,
  ].filter(Boolean),
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: "VITE_",
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // 目标设为 es2019：转译可选链 ?. 和空值合并 ?? 等 ES2020 语法。
    // 原因：Android System WebView 在旧机型/模拟器上可能停留在 Chrome 74
    //（API 29 自带），不支持 ES2020。若保留 es2021，esbuild 不转译
    // ?./??，旧 WebView 解析期直接 SyntaxError → React 不挂载 → 白屏且无报错。
    target: "es2019",
    // CSS 另设浏览器目标：es2019 是 JS 年份，esbuild 据此无法判断 CSS 特性支持度，
    // 会当作「什么都支持」——不仅不降级新语法，还会把 top/right/bottom/left
    // 主动合并成 Chrome 87 才有的 inset 简写，手写长写法也会被合回去。
    // 指名 chrome74（Android 10 自带 WebView 版本）后，esbuild 才会反过来
    // 拆简写、降级 :where()/:is() 等选择器。
    cssTarget: "chrome74",
    sourcemap: true,
  },
});
