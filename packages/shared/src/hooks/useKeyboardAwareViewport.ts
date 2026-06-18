import { useEffect } from "react";

/** 可编辑元素的标签名 —— 聚焦这些元素时会唤起软键盘 */
const EDITABLE_TAGS = ["INPUT", "TEXTAREA"];

/** 判断元素是否为可输入元素（input / textarea / contenteditable） */
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (EDITABLE_TAGS.includes(el.tagName)) return true;
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * 键盘感知视口 Hook —— 让移动端软键盘弹出时把内容顶起，而非遮挡输入框
 *
 * @description
 * 移动端（尤其 Tauri Android，MainActivity 启用了 `enableEdgeToEdge()`）软键盘默认
 * 以「覆盖层」形式叠加在 WebView 之上，不会压缩窗口，导致底部输入框被键盘挡住。
 *
 * 本 Hook 通过 W3C **VisualViewport API** 监听可见视口高度变化：
 * 1. 键盘弹出 → `visualViewport.height` 收缩 → 写入 CSS 变量 `--app-height`，
 *    配合 `.app-screen { height: var(--app-height) }`（见 design-system 的 global.css），
 *    所有 flex 列布局随之收缩，底部输入区/居中表单自然上移到键盘之上。
 * 2. 额外暴露 `--keyboard-inset`（键盘占据高度），供需要精确避让的组件使用。
 * 3. 聚焦输入框时把它 `scrollIntoView` 到可见区域中央，确保长表单中被遮挡的字段可见。
 *
 * **降级**：不支持 `VisualViewport` 的环境（旧 WebView / 桌面端无键盘）静默退化——
 * `--app-height` 回退到 `100vh`，与改造前行为完全一致，桌面端无副作用。
 *
 * **兼容性**：`VisualViewport` 自 Chrome 61 起支持，覆盖项目最低目标 Chrome 74；
 * `scrollIntoView({ block })` 同样在 Chrome 61+ 可用。无新增需转译的语法。
 *
 * @example
 * function App() {
 *   useKeyboardAwareViewport(); // 在应用根组件调用一次即可
 *   return <Routes>...</Routes>;
 * }
 */
export function useKeyboardAwareViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    // 不支持 VisualViewport（旧 WebView / SSR）：静默降级，.app-screen 回退 100vh
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;

    /** 将当前可见视口高度与键盘高度写入 CSS 变量 */
    const apply = () => {
      root.style.setProperty("--app-height", `${vv.height}px`);
      // 键盘高度 = 布局视口高度 − 可见视口高度 − 顶部偏移（去掉地址栏/状态栏影响）
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    };

    /** 视口尺寸变化（键盘弹/收）：用 rAF 合并抖动，并把聚焦输入框滚入可见区 */
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        apply();
        const active = document.activeElement;
        if (isEditable(active)) {
          (active as HTMLElement).scrollIntoView({ block: "center" });
        }
      });
    };

    /**
     * 聚焦兜底：部分机型聚焦输入框不会触发 visualViewport resize，
     * 这里延迟到键盘动画结束后主动把输入框滚到中央。
     */
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (!isEditable(target)) return;
      window.setTimeout(() => {
        (target as HTMLElement).scrollIntoView({ block: "center" });
      }, 300);
    };

    apply();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", apply);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", apply);
      document.removeEventListener("focusin", onFocusIn);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
