import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@yuanchat/design-system": resolve(__dirname, "../../packages/design-system/src"),
      "@yuanchat/shared": resolve(__dirname, "../../packages/shared/src"),
      "@yuanchat/ui": resolve(__dirname, "../../packages/ui/src"),
    },
  },
});
