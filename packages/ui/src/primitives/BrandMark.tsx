import { useId } from "react";

export interface BrandMarkProps {
  /** 边长（px），默认 30 —— 与原先 `<MessageCircle size={30} />` 等大 */
  size?: number;
  /** 追加类名 */
  className?: string;
}

/**
 * BrandMark — 元聊品牌图形：气泡 + 镂空的「元」字
 *
 * @description
 * 与应用图标（`.design/icon/source.svg` → `src-tauri/icons/`、`public/pwa-*.png`）
 * 同一套画法，确保启动器里看到的和应用内看到的是同一个标识。
 *
 * **「元」字是镂空的**（mask 里涂黑 = 透明孔），底色由父元素提供。因此本组件
 * 必须放在带背景的容器里用 —— 项目里一律是 `.brand-gradient` 那个圆角方块；
 * 放在白底上会只剩一团白，看不见。
 *
 * mask id 走 `useId()`：同一页面渲染多个实例时，固定 id 会相互覆盖
 * （SVG 的 id 是文档级的，不是组件级的）。
 *
 * @example
 * <div className="brand-gradient flex h-16 w-16 items-center justify-center rounded-lg">
 *   <BrandMark size={34} />
 * </div>
 */
export function BrandMark({ size = 30, className }: BrandMarkProps) {
  // useId() 的返回值形如 `:r1:`，冒号在 url(#…) 片段引用里能用，但会让
  // querySelector("#…") 直接抛错（测试与调试时踩到就很难找），这里去掉
  const maskId = "brand-mark-" + useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label="元聊 YuanChat"
    >
      <mask id={maskId}>
        <rect width="1024" height="1024" fill="black" />
        <rect x="160" y="196" width="704" height="528" rx="172" fill="white" />
        <path
          d="M388 676 L344 828 L512 700 Z"
          fill="white"
          stroke="white"
          strokeWidth="48"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <g fill="none" stroke="black" strokeWidth="54" strokeLinecap="round" strokeLinejoin="round">
          <path d="M414 348 H628" />
          <path d="M336 448 H688" />
          <path d="M458 448 C458 546 430 606 392 644" />
          <path d="M578 448 V566 C578 610 606 630 668 624" />
        </g>
      </mask>
      <rect width="1024" height="1024" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
