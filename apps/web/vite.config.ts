import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
    sourcemap: true,
  },
});
