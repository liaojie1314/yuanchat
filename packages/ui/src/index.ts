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
 * - 聊天组件：ConversationList、ChatWindow、MessageBubble、Composer、ChatDetail
 * - 布局组件：MainLayout（页面框架）
 */

// 基础 UI 组件
export { Button } from "./Button";
export type { ButtonVariant } from "./Button";
export { Input } from "./Input";
export { Avatar } from "./Avatar";
export { ResizeHandle } from "./ResizeHandle";
export { ToastHost } from "./Toast";
export { ConfirmDialog } from "./ConfirmDialog";

// 聊天组件
export { ConversationList } from "./ConversationList";
export { ChatWindow } from "./ChatWindow";
export { MessageBubble, TypingIndicator } from "./MessageBubble";
export { MessageImage } from "./MessageImage";
export { ImageLightbox } from "./ImageLightbox";
export { Composer } from "./Composer";
export { EmojiPicker } from "./EmojiPicker";
export { EMOJI_CATEGORIES } from "./emojiData";
export type { EmojiCategory } from "./emojiData";
export { ChatDetail } from "./ChatDetail";
export { ChatScreen } from "./ChatScreen";
export { MembersView } from "./MembersView";
export { CreateGroupModal } from "./CreateGroupModal";
export { InviteMembersModal } from "./InviteMembersModal";
export { MentionPicker } from "./MentionPicker";
export { ForwardModal } from "./ForwardModal";

// 通讯录组件
export { ContactsScreen } from "./ContactsScreen";
export { ContactsPanel } from "./ContactsPanel";
export { ContactDetail } from "./ContactDetail";
export { BlocklistView } from "./BlocklistView";
export { NewFriendsView } from "./NewFriendsView";
export { AddContactModal } from "./AddContactModal";

// 设置组件
export { SettingsScreen } from "./SettingsScreen";
export { ProfileEditView } from "./ProfileEditView";

// 布局组件
export { MainLayout } from "./MainLayout";
