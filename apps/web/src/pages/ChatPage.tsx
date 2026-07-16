/**
 * ChatPage — 聊天主页面（Web 端）
 *
 * @description
 * 三端响应式编排全部收敛在 @yuanchat/ui 的 ChatScreen 中：
 * 桌面四栏 / 平板抽屉 / 手机栈式由 useBreakpoint 自动切换。
 */
import { ChatScreen } from "@yuanchat/ui";

export function ChatPage() {
  return <ChatScreen />;
}
