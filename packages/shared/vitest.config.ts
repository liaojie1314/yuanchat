import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@yuanchat/design-system": resolve(__dirname, "../design-system/src"),
    },
  },
});
