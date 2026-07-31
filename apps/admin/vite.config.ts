import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("./package.json", "utf-8")).version as string;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: true,
  },
  envPrefix: "VITE_",
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: "es2019",
    sourcemap: true,
  },
});
