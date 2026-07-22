/**
 * ChatPage — 聊天主页面（Tauri 桌面 / 移动端）
 *
 * @description
 * 三端响应式编排全部收敛在 @yuanchat/ui 的 ChatScreen 中：
 * 桌面四栏 / 平板抽屉 / 手机栈式由 useBreakpoint 按窗口宽度自动切换，
 * Tauri Android WebView 下自然落在 mobile 分支。
 */
import { ChatScreen } from "@yuanchat/ui";

export function ChatPage() {
  return <ChatScreen />;
}
