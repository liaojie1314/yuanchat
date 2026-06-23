/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-tailwindcss"],
  rules: {
    // 与 Tailwind 兼容的规则调整
    "no-descending-specificity": [true, { severity: "warning" }],
    // 允许 Tailwind 的 @apply 中使用的自定义属性
    "custom-property-pattern": null,
    // 允许 :root 中的大量自定义属性
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
    // 允许项目已有的 camelCase keyframes（如 auroraFloat、sweepDown）
    "keyframes-name-pattern": /^[a-z][a-zA-Z0-9-]*$/,
  },
};
