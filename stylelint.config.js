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
    // 禁用 vendor-prefix 检查 — 本项目需兼容旧 WebView（Chrome 74），
    // 自动移除 -webkit- 前缀会破坏兼容性
    "property-no-vendor-prefix": null,
    // word-break: break-word 虽被标为废弃，但在 Chrome 74 中是唯一有效的
    // 换行方案（overflow-wrap: anywhere 需要 Chrome 80+）
    "declaration-property-value-keyword-no-deprecated": null,
    // inset / place-items / place-content 三个简写旧 WebView（Chrome 74）不认：
    // inset 要 Chrome 87，place-items 的单值形式在 74 上只落一半。
    // 全文的长写法都是为它们准备的兜底，不能被合并回简写
    "declaration-block-no-redundant-longhand-properties": [
      true,
      { ignoreShorthands: ["inset", "place-items", "place-content"] },
    ],
  },
};
