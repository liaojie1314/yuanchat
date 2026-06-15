/**
 * @yuanchat/ui 包入口
 *
 * @description
 * 统一导出所有共享 UI 组件，app 端通过以下方式导入：
 * ```tsx
 * import { Button, Input, Avatar, ConversationList, ChatWindow, MainLayout } from "@yuanchat/ui";
 * ```
 *
 * 组件分为三类：
 * - 基础 UI：Button、Input、Avatar（可复用的原子组件）
 * - 聊天组件：ConversationList、ChatWindow、ChatDetail（IM 专用业务组件）
 * - 布局组件：MainLayout（页面框架）
 */

// 基础 UI 组件
export { Button } from "./Button";
export type { ButtonVariant } from "./Button";
export { Input } from "./Input";
export { Avatar } from "./Avatar";

// 聊天组件
export { ConversationList } from "./ConversationList";
export { ChatWindow } from "./ChatWindow";
export { ChatDetail } from "./ChatDetail";

// 布局组件
export { MainLayout } from "./MainLayout";
