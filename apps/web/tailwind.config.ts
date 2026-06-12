import type { Config } from "tailwindcss";
import { yuanchatPreset } from "@yuanchat/design-system/tailwind";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [yuanchatPreset],
} satisfies Config;
