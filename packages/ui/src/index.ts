/**
 * @yuanchat/ui 包入口
 *
 * @description
 * 统一导出所有共享 UI 组件，app 端通过以下方式导入：
 * ```tsx
 * import { Button, Input, Avatar, ConversationList, ChatWindow, MainLayout } from "@yuanchat/ui";
 * ```
 *
 * 三端一律只从本文件这个 barrel 导入，**不要**写 `@yuanchat/ui/chat/ChatWindow`
 * 这类深路径。源码按功能域分目录，目录职责如下：
 *
 * - `primitives/` 无业务语义的原子组件：Button、Input、Avatar、GroupAvatar、Toast、
 *   ConfirmDialog、ResizeHandle、AppErrorBoundary
 * - `layout/` 页面框架与全局浮层：MainLayout（路由 Layout Route）、SearchModal
 * - `chat/` 会话与消息：会话列表、聊天窗口、消息气泡与各类消息体、输入区、
 *   表情面板、语音播放、图片/视频查看
 * - `call/` 音视频通话：通话窗口、邀请弹窗、发起/加入通话的动作层与时长格式化
 * - `contacts/` 通讯录与群成员：联系人列表/详情、加好友、黑名单、新朋友、
 *   建群与邀请成员、成员管理
 * - `e2ee/` 端到端加密相关 UI：加密状态指示、安全指纹校验、设置内的 E2EE 管理块
 * - `stickers/` 表情商城：表情缩略/封面、商城与详情页、发布与编辑页、上传工具
 * - `settings/` 设置页及其分区、资料编辑
 * - `favorites/` 我的收藏
 * - `auth/` 登录相关：找回密码、扫码登录、修改密码、二维码解析
 * - `moments/` 朋友圈：信息流、动态卡片与媒体网格、发布页、互动消息页
 * - `util/` 跨域复用的小工具与 hook：复制文本、文件图标、长按手势、子页返回键语义
 */

// 基础 UI 组件
export { Button } from "./primitives/Button";
export type { ButtonVariant } from "./primitives/Button";
export { Input } from "./primitives/Input";
export { Avatar } from "./primitives/Avatar";
export { GroupAvatar } from "./primitives/GroupAvatar";
export { ResizeHandle } from "./primitives/ResizeHandle";
export { ToastHost } from "./primitives/Toast";
export { ConfirmDialog } from "./primitives/ConfirmDialog";

// 聊天组件
export { ConversationList } from "./chat/ConversationList";
export { ChatWindow } from "./chat/ChatWindow";
export { MessageBubble, TypingIndicator } from "./chat/MessageBubble";
export { MessageImage } from "./chat/MessageImage";
export { MessageVideo } from "./chat/MessageVideo";
export { StickerImage } from "./stickers/StickerImage";
export { ImageLightbox } from "./chat/ImageLightbox";
export { VideoPlaybackOverlay } from "./chat/VideoPlaybackOverlay";
export { ConversationMediaView } from "./chat/ConversationMediaView";
export { Composer } from "./chat/Composer";
export { EmojiPicker } from "./chat/EmojiPicker";
export { EMOJI_CATEGORIES } from "./chat/emojiData";
export type { EmojiCategory } from "./chat/emojiData";
export { ChatDetail } from "./chat/ChatDetail";
export { AnnouncementDialog } from "./chat/AnnouncementDialog";
export { MessageEditHistoryDialog } from "./chat/MessageEditHistoryDialog";
export type { MessageEditHistoryDialogProps } from "./chat/MessageEditHistoryDialog";
export { ChatScreen } from "./chat/ChatScreen";
export { MembersView } from "./contacts/MembersView";
export { CreateGroupModal } from "./contacts/CreateGroupModal";
export { InviteMembersModal } from "./contacts/InviteMembersModal";
export { MentionPicker } from "./chat/MentionPicker";
export { ForwardModal } from "./chat/ForwardModal";
export { UserProfileView } from "./contacts/UserProfileView";

// 通话组件
export { CallView } from "./call/CallView";
export {
  startCall,
  joinCall,
  probeLocalMedia,
  canUseWebRTC,
  setCallLauncher,
  setNativeVideoResolver,
} from "./call/callActions";
export type { CallLaunchRequest, CallLauncher, NativeVideoResolver } from "./call/callActions";
export { CallHost } from "./call/CallHost";
export { CallInviteModal, MAX_CALL_INVITEES } from "./call/CallInviteModal";
export { formatCallDuration, callRecordKey } from "./call/callFormat";

// 通讯录组件
export { ContactsScreen } from "./contacts/ContactsScreen";
export { ContactsPanel } from "./contacts/ContactsPanel";
export { ContactDetail } from "./contacts/ContactDetail";
export { BlocklistView } from "./contacts/BlocklistView";
export { NewFriendsView } from "./contacts/NewFriendsView";
export { FavoritesView } from "./favorites/FavoritesView";
export { AddContactModal } from "./contacts/AddContactModal";

// 表情商城组件与页面
export { StickerThumb } from "./stickers/StickerThumb";
export { StickerPackCover } from "./stickers/StickerPackCover";
export { StickerSourcePicker } from "./stickers/StickerSourcePicker";
export { StickerMarketView } from "./stickers/StickerMarketView";
export { StickerPackDetailView } from "./stickers/StickerPackDetailView";
export { StickerPublishView } from "./stickers/StickerPublishView";
export { StickerPackEditView } from "./stickers/StickerPackEditView";
export { StickerMineView } from "./stickers/StickerMineView";

// 朋友圈组件
export { MomentMediaGrid } from "./moments/MomentMediaGrid";
export { MomentPostCard } from "./moments/MomentPostCard";
export { MomentsScreen } from "./moments/MomentsScreen";
export { MomentComposeView } from "./moments/MomentComposeView";
export { MomentActivitiesView } from "./moments/MomentActivitiesView";

// 设置组件
export { SettingsScreen } from "./settings/SettingsScreen";
export { ProfileEditView } from "./settings/ProfileEditView";

// 布局组件
export { MainLayout } from "./layout/MainLayout";
export { SearchModal } from "./layout/SearchModal";
export { E2EEIndicator } from "./e2ee/E2EEIndicator";
export { SafetyNumberDialog } from "./e2ee/SafetyNumberDialog";
export { E2EESection } from "./e2ee/E2EESection";
export { InConversationSearch } from "./chat/InConversationSearch";

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
export { AppErrorBoundary } from "./primitives/AppErrorBoundary";

// 跨域复用的小工具 hook
export { useBackTo } from "./util/useBackTo";
