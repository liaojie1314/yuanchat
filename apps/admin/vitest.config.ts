import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom 而非 node：authStore 的 zustand persist 要 window.localStorage，
    // node 环境下每次 setState 都往 stderr 刷一条 storage unavailable
    environment: "jsdom",
    globals: true,
  },
});
