import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "node:fs";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const version = JSON.parse(readFileSync("./package.json", "utf-8")).version as string;

export default defineConfig({
  plugins: [
    react(),
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG || "",
          project: process.env.SENTRY_PROJECT_DESKTOP || "",
          release: { name: version },
          sourcemaps: { assets: "dist/**" },
          telemetry: false,
        })
      : null,
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // 始终监听所有接口（0.0.0.0），桌面端和移动端均可达。
    // TAURI_DEV_HOST 仅用于告诉 Tauri WebView 加载哪个 URL，
    // 不应用于 Vite 自身的 host（模拟器中 10.0.2.2 在宿主机上不存在）
    host: "0.0.0.0",
    // HMR WebSocket 复用页面所在的 localhost:1420 隧道：
    // tauri android dev 通过 `adb reverse tcp:1420` 把设备 localhost:1420 转发到宿主机，
    // HMR 走同一端口即可被设备访问；桌面端 WebView 直接走 localhost 同样生效。
    // ⚠️ host 不能用 "0.0.0.0"——那是服务端绑定地址，浏览器无法把它作为连接目标，
    // 会导致 ws://0.0.0.0:1421 ERR_CONNECTION_REFUSED、热重载失效（页面能开但改代码不刷新）。
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1420,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // 目标设为 es2019：转译可选链 ?. 和空值合并 ?? 等 ES2020 语法。
    // 原因：Android System WebView 在旧机型/模拟器上可能停留在 Chrome 74
    //（API 29 自带），不支持 ES2020。若保留 chrome105/es2020，esbuild 不转译
    // ?./??，旧 WebView 解析期直接 SyntaxError → React 不挂载 → 白屏且无报错。
    // es2019 在所有现代桌面 WebView（WebView2 / WebKitGTK）上同样兼容。
    target: "es2019",
    // CSS 另设浏览器目标：es2019 是 JS 年份，esbuild 据此无法判断 CSS 特性支持度，
    // 会当作「什么都支持」——不仅不降级新语法，还会把 top/right/bottom/left
    // 主动合并成 Chrome 87 才有的 inset 简写，手写长写法也会被合回去。
    // 指名 chrome74（Android 10 自带 WebView 版本）后，esbuild 才会反过来
    // 拆简写、降级 :where()/:is() 等选择器。
    cssTarget: "chrome74",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG || !!process.env.SENTRY_AUTH_TOKEN,
  },
});
