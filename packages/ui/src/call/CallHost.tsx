/**
 * CallHost 组件 — Web / 移动端的通话浮层宿主
 *
 * @description
 * 读 `callStore` 决定挂不挂 {@link CallView}，`phase === "idle"` 时返回 null。
 * 挂在 `MainLayout` 的两个分支里（与 `ToastHost` 同级），因此切页面、进设置、
 * 看联系人都不中断通话。
 *
 * portal 到 `document.body` 的理由同 {@link VideoPlaybackOverlay}：调用点所在的
 * 祖先链上可能有 `transform`（虚拟滚动行），那会成为 `fixed` 定位的包含块，
 * 不出去浮层就缩到那一小块区域里。
 *
 * **最小化不在这里分支**：悬浮条与全屏态都由 `CallView` 自己渲染 —— 若在宿主层
 * 切换组件，`PeerMesh` 会随卸载被拆掉，点一下「最小化」通话就断了。
 */
import { createPortal } from "react-dom";
import { useCallStore } from "@yuanchat/shared";
import { CallView } from "./CallView";

export function CallHost() {
  const phase = useCallStore((s) => s.phase);
  if (phase === "idle") return null;
  return createPortal(<CallView />, document.body);
}
