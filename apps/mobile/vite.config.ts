import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // 移动端开发时允许局域网访问（方便手机调试）
    host: true,
  },
  envPrefix: "VITE_",
  build: {
    target: "es2021",
    // Capacitor 要求相对路径
    base: "./",
    outDir: "dist",
  },
});
