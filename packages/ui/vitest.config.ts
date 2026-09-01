import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/__tests__/**", "src/index.ts"],
      // 覆盖率阈值（低于此值 CI 失败）。目标 60%，现状 55.8%，先钉基线 -2pt，
      // 补齐组件测试后逐步上调（B7 re-raise 待办）。
      thresholds: {
        statements: 53,
        lines: 53,
      },
    },
  },
  resolve: {
    alias: {
      "@yuanchat/design-system": resolve(__dirname, "../design-system/src"),
      "@yuanchat/shared": resolve(__dirname, "../shared/src"),
    },
  },
});
