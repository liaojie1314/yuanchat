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
export { MessageVideo } from "./MessageVideo";
export { StickerImage } from "./StickerImage";
export { ImageLightbox } from "./ImageLightbox";
export { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
export { ConversationMediaView } from "./ConversationMediaView";
export { Composer } from "./Composer";
export { EmojiPicker } from "./EmojiPicker";
export { EMOJI_CATEGORIES } from "./emojiData";
export type { EmojiCategory } from "./emojiData";
export { ChatDetail } from "./ChatDetail";
export { AnnouncementDialog } from "./AnnouncementDialog";
export { MessageEditHistoryDialog } from "./MessageEditHistoryDialog";
export type { MessageEditHistoryDialogProps } from "./MessageEditHistoryDialog";
export { ChatScreen } from "./ChatScreen";
export { MembersView } from "./MembersView";
export { CreateGroupModal } from "./CreateGroupModal";
export { InviteMembersModal } from "./InviteMembersModal";
export { MentionPicker } from "./MentionPicker";
export { ForwardModal } from "./ForwardModal";
export { UserProfileView } from "./UserProfileView";

// 通话组件
export { CallView } from "./CallView";
export {
  startCall,
  joinCall,
  probeLocalMedia,
  canUseWebRTC,
  setCallLauncher,
  setNativeVideoResolver,
} from "./callActions";
export type { CallLaunchRequest, CallLauncher, NativeVideoResolver } from "./callActions";
export { CallHost } from "./CallHost";
export { CallInviteModal, MAX_CALL_INVITEES } from "./CallInviteModal";
export { formatCallDuration, callRecordKey } from "./callFormat";

// 通讯录组件
export { ContactsScreen } from "./ContactsScreen";
export { ContactsPanel } from "./ContactsPanel";
export { ContactDetail } from "./ContactDetail";
export { BlocklistView } from "./BlocklistView";
export { NewFriendsView } from "./NewFriendsView";
export { FavoritesView } from "./FavoritesView";
export { AddContactModal } from "./AddContactModal";

// 表情商城组件与页面
export { StickerThumb } from "./StickerThumb";
export { StickerPackCover } from "./StickerPackCover";
export { StickerSourcePicker } from "./StickerSourcePicker";
export { StickerMarketView } from "./StickerMarketView";
export { StickerPackDetailView } from "./StickerPackDetailView";
export { StickerPublishView } from "./StickerPublishView";
export { StickerPackEditView } from "./StickerPackEditView";
export { StickerMineView } from "./StickerMineView";

// 设置组件
export { SettingsScreen } from "./SettingsScreen";
export { ProfileEditView } from "./ProfileEditView";

// 布局组件
export { MainLayout } from "./MainLayout";
export { SearchModal } from "./SearchModal";
export { E2EEIndicator } from "./E2EEIndicator";
export { SafetyNumberDialog } from "./SafetyNumberDialog";
export { E2EESection } from "./E2EESection";
export { InConversationSearch } from "./InConversationSearch";

// 认证组件
export { ForgotPasswordScreen } from "./auth/ForgotPasswordScreen";
export type { ForgotPasswordScreenProps } from "./auth/ForgotPasswordScreen";
export { QrLoginScreen } from "./auth/QrLoginScreen";
export type { QrLoginScreenProps } from "./auth/QrLoginScreen";
export { mapAuthError } from "./auth/mapAuthError";
export { ScanQrEntry } from "./auth/ScanQrEntry";
export { parseLoginQr } from "./auth/parseLoginQr";
export { ChangePasswordDialog } from "./auth/ChangePasswordDialog";
export type { ChangePasswordDialogProps } from "./auth/ChangePasswordDialog";
export type { ScanQrEntryProps, ScanFn } from "./auth/ScanQrEntry";

// 错误边界
export { AppErrorBoundary } from "./AppErrorBoundary";
