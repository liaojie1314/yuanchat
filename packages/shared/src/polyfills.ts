/**
 * 旧 WebView 运行时补丁
 *
 * @description
 * `build.target=es2019` 只降级「语法」，不会补「内置方法」：依赖里一旦用到
 * ES2020+ 新增的 API，旧 WebView 上就是运行期 TypeError。已踩到的是
 * `@noble/curves`（E2EE 用的椭圆曲线库）——它在模块初始化阶段调用
 * `Object.hasOwn`（ES2022 / Chrome 93+）校验参数，而 Android 10 自带的
 * WebView 74 没有这个方法，异常抛在 React 挂载之前，界面是整屏空白且零提示，
 * 和当年 `?.` 语法未转译的白屏一模一样。
 *
 * 只补确实被用到的方法（凭空补一堆没人调用的 API 只是死代码），
 * 且必须早于任何业务模块执行，所以各端入口把本文件放在 import 列表首位。
 *
 * 同一批「旧引擎能力探测」也放在这里：CSS 里查不出 flex gap 支持情况，
 * 只能用 JS 量一次，量完在 `<html>` 上留标记给样式层兜底。
 */

/** Object 构造器的可写视图：项目 tsconfig 的 lib 停在 ES2021，类型里还没有 hasOwn */
interface ObjectConstructorWithHasOwn {
  hasOwn?: (target: object, key: PropertyKey) => boolean;
}

const objectCtor = Object as ObjectConstructor & ObjectConstructorWithHasOwn;

if (typeof objectCtor.hasOwn !== "function") {
  objectCtor.hasOwn = function hasOwn(target: object, key: PropertyKey): boolean {
    // 与规范一致：null / undefined 先于取属性抛 TypeError，
    // 否则 Object(null) 会返回空对象，把「传错参数」悄悄变成 false
    if (target === null || target === undefined) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    return Object.prototype.hasOwnProperty.call(Object(target), key);
  };
}

/**
 * 实测 flex 容器的 gap 是否生效
 *
 * @description
 * flex gap 要 Chrome 84，`@supports (gap: 1px)` 却无法用来判断——grid 的 gap
 * 从 Chrome 66 就支持，查询在旧引擎上同样返回 true。只能真的摆两个盒子量宽度。
 *
 * @returns true 支持 / false 不支持 / null 无法判断（无排版引擎，如 jsdom）
 */
function detectFlexGap(): boolean | null {
  const probe = document.createElement("div");
  probe.style.cssText =
    "display:flex;gap:10px;position:absolute;visibility:hidden;pointer-events:none;width:auto";
  for (let i = 0; i < 2; i++) {
    const cell = document.createElement("span");
    cell.style.cssText = "display:block;width:10px;height:1px;flex:0 0 auto";
    probe.appendChild(cell);
  }
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  // 支持时收缩宽度 = 10 + 10 + gap 10 = 30；不支持则为 20；
  // 拿到 0 说明环境根本不排版（测试环境），此时不做任何判定
  if (width === 0) return null;
  return width > 25;
}

/**
 * 检测 CSS `aspect-ratio` 是否可用
 *
 * @description
 * aspect-ratio 要 Chrome 88。它与 flex gap 不同，可以直接查询——
 * 旧引擎认不出这个属性名，CSS.supports 会如实返回 false。
 *
 * @returns true 支持 / false 不支持或无法查询
 */
function supportsAspectRatio(): boolean {
  return typeof CSS !== "undefined" && CSS.supports?.("aspect-ratio", "1 / 1") === true;
}

// 旧引擎打标记，样式层据此启用兜底：
// - no-flex-gap → gap 改用相邻兄弟 margin（legacyWebViewCompat 插件生成）
// - no-aspect-ratio → aspect-square 改用百分比 padding 撑高（global.css）
if (typeof document !== "undefined" && document.body) {
  if (detectFlexGap() === false) {
    document.documentElement.classList.add("no-flex-gap");
  }
  if (!supportsAspectRatio()) {
    document.documentElement.classList.add("no-aspect-ratio");
  }
}
