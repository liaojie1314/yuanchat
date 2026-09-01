import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // tailwind.config.ts 是构建期配置文件而非运行时代码，不计入覆盖率
      exclude: ["src/__tests__/**", "src/i18n/**", "src/index.ts", "src/tailwind.config.ts"],
      // 覆盖率阈值（低于此值 CI 失败）。目标 60%，现状 48.9%（skins.ts /
      // legacyWebViewCompat.ts 未覆盖），先钉基线 -2pt，补测试后上调（B7 re-raise 待办）。
      thresholds: {
        statements: 46,
        lines: 46,
      },
    },
  },
});
