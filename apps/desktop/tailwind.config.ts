import type { Config } from "tailwindcss";
import { yuanchatPreset } from "@yuanchat/design-system/tailwind";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // 包含 workspace 包中的组件（它们使用 Tailwind 类名）
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [yuanchatPreset],
} satisfies Config;
