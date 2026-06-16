import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
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
    // HMR WebSocket 也监听 0.0.0.0，避免模拟器中 10.0.2.2 不可达
    hmr: {
      protocol: "ws",
      host: "0.0.0.0",
      port: 1421,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // 目标设为 es2019：转译可选链 ?. 和空值合并 ?? 等 ES2020 语法。
    // 原因：Android System WebView 在旧机型/模拟器上可能停留在 Chrome 74
    //（API 29 自带），不支持 ES2020。若保留 chrome105/es2020，esbuild 不转译
    // ?./??，旧 WebView 解析期直接 SyntaxError → React 不挂载 → 白屏且无报错。
    // es2019 在所有现代桌面 WebView（WebView2 / WebKitGTK）上同样兼容。
    target: "es2019",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
