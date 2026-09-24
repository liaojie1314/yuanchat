/**
 * 旧 WebView 样式兼容插件
 *
 * @description
 * Android 10 自带的 WebView 停在 Chrome 74，flex 容器的 `gap` 要 Chrome 84 才支持，
 * 而且是「静默失效」——不报错、只是不生效，图标与文字紧紧贴在一起，因此最难发现。
 *
 * 应对方式：`gap-*` 额外输出一份 margin 兜底，只在 `<html>` 带 `no-flex-gap` 时命中；
 * 该类名由 `@yuanchat/shared/polyfills` 实测引擎能力后才添加，
 * 支持 flex gap 的引擎上这些规则永远不会生效。
 *
 * 兜底分两种：
 * - 相邻兄弟：`> * + *` 按主轴方向加外边距，四种 flex-direction 各自朝向不同
 *   （row 加左、row-reverse 加右、column 加上、column-reverse 加下），
 *   方向搞错等于没有间距——反向容器里第二个元素在视觉上位于第一个之前
 * - 单个图标：`> svg:only-child` 加尾边距。CSS 选择器只能命中元素，
 *   而 `<button><Icon/>{文案}</button>` 里的文案是裸文本节点（匿名 flex item），
 *   `* + *` 永远命中不到；这类「图标 + 文案」行在设置项、菜单项里到处都是，
 *   只能反过来给唯一的那个图标加边距
 *
 * grid 的 gap 从 Chrome 66 起就支持，所以兜底只挂在 `.flex` / `.inline-flex`
 * 上——挂到 grid 会与原生 gap 叠加，间距直接翻倍。
 *
 * @remarks 兜底用相邻兄弟选择器，因此换行（flex-wrap）后的多行行间距无法兜底；
 *   旧 WebView 上换行容器的行距会偏小，属可接受的降级。
 * @remarks 「文案 + 图标」（图标在后）的写法拿不到正确的边距方向，
 *   这类地方需要把文案自己包一层元素，让 `* + *` 能命中。
 */
import plugin from "tailwindcss/plugin";

/** 探测到 flex gap 不可用时，由前端在 `<html>` 上添加的类名 */
export const NO_FLEX_GAP_CLASS = "no-flex-gap";

/** flex 容器的两种 display */
const FLEX_DISPLAY = [".flex", ".inline-flex"];

/**
 * 四种主轴方向各自的容器选择器与补偿边距属性
 *
 * @remarks row 需显式排除其余三种方向类名：不写 `:not()` 的话，
 *   `.flex-col` 元素会同时命中 row 与 column 两套规则，两个方向都被加上边距。
 */
const DIRECTIONS = [
  {
    /** 默认横排：不带任何 flex-direction 类名 */
    match: ":not(.flex-row-reverse):not(.flex-col):not(.flex-col-reverse)",
    sibling: "marginLeft",
    trailing: "marginRight",
  },
  { match: ".flex-row-reverse", sibling: "marginRight", trailing: "marginLeft" },
  { match: ".flex-col", sibling: "marginTop", trailing: "marginBottom" },
  { match: ".flex-col-reverse", sibling: "marginBottom", trailing: "marginTop" },
] as const;

/**
 * 拼出旧引擎下的兜底声明
 *
 * @param value - 该 gap 工具类对应的间距值
 * @param axis - 只补某一根轴（gap-x / gap-y），省略则两根轴都补
 * @returns 可直接展开进工具类的嵌套选择器声明
 */
function fallbackRules(value: string, axis?: "row" | "column"): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const dir of DIRECTIONS) {
    const isColumn = dir.match.indexOf(".flex-col") === 0;
    if (axis === "row" && isColumn) continue;
    if (axis === "column" && !isColumn) continue;
    for (const display of FLEX_DISPLAY) {
      const container = `html.${NO_FLEX_GAP_CLASS} &${display}${dir.match}`;
      rules[`${container} > * + *`] = { [dir.sibling]: value };
      rules[`${container} > svg:only-child`] = { [dir.trailing]: value };
    }
  }
  return rules;
}

export const legacyWebViewCompat = plugin(({ matchUtilities, theme }) => {
  matchUtilities(
    {
      gap: (value: string) => ({ gap: value, ...fallbackRules(value) }),
    },
    { values: theme("gap") },
  );

  matchUtilities(
    {
      "gap-x": (value: string) => ({ columnGap: value, ...fallbackRules(value, "row") }),
      "gap-y": (value: string) => ({ rowGap: value, ...fallbackRules(value, "column") }),
    },
    { values: theme("gap") },
  );
});
