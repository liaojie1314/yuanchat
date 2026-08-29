/**
 * ChatPage — 聊天主页面（Tauri 桌面 / 移动端）
 *
 * @description
 * 三端响应式编排全部收敛在 @yuanchat/ui 的 ChatScreen 中：
 * 桌面四栏 / 平板抽屉 / 手机栈式由 useBreakpoint 按窗口宽度自动切换，
 * Tauri Android WebView 下自然落在 mobile 分支。
 *
 * 扫码登录入口只在移动端注入：桌面端没有原生相机实现（Cargo.toml 里就没编进
 * barcode-scanner 插件），传进去只会在点击时报错。这里的端判定刻意留在 app 外壳，
 * 不下沉到 ChatScreen —— packages/ui 的组件不做端区分。
 */
import { ChatScreen } from "@yuanchat/ui";
import { useIsMobile } from "../hooks/useIsMobile";
import { scanWithNativeCamera } from "../lib/nativeScan";

export function ChatPage() {
  const isMobile = useIsMobile();
  return <ChatScreen scan={isMobile ? scanWithNativeCamera : undefined} />;
}
