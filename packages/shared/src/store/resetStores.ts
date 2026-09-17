import { useBlocklistStore } from "./blocklistStore";
import { useCallStore } from "./callStore";
import { useContactStore } from "./contactStore";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";
import { useMomentsStore } from "./momentsStore";
import { usePresenceStore } from "./presenceStore";
import { resetIceServersCache } from "../webrtc/iceServers";
import { ringtone } from "../webrtc/ringtone";

/** 登出/切换账号时调用：revoke 全部本地图片 blob 后清空聊天相关 store，防内存泄漏与跨账号数据残留 */
export function resetChatStores(): void {
  revokeAllLocalPreviews();
  useMessageStore.setState({
    messagesByConv: {},
    hasMoreByConv: {},
    typingByConv: {},
    replyingTo: null,
  });
  useConversationStore.setState({ conversations: [], activeId: null, loading: false });
  useContactStore.setState({ friends: [], requests: [], loading: false });
  useBlocklistStore.setState({ items: [], loading: false });
  usePresenceStore.setState({ onlineIds: [] });
  // 朋友圈：残留的 unreadCount 会让下个账号一登录就看到上个账号的红点
  useMomentsStore.setState({
    posts: [],
    nextCursor: "",
    hasMore: true,
    loading: false,
    unreadCount: 0,
    activities: [],
  });
  // 通话：残留的 phase 会让下一次登录直接顶出一个幽灵通话界面；
  // 铃声不停会一直响到系统超时；TURN 凭据的 username 里编了旧 user_id，必须重签
  ringtone.stop();
  useCallStore.getState().reset();
  resetIceServersCache();
}

/** 遍历所有会话消息，撤销未清理的本地 blob 预览 URL（图片 + 文件 + 语音） */
export function revokeAllLocalPreviews(): void {
  if (typeof URL === "undefined" || !URL.revokeObjectURL) return;
  const byConv = useMessageStore.getState().messagesByConv;
  for (const list of Object.values(byConv)) {
    for (const m of list) {
      if (m.image && m.image.localUrl) URL.revokeObjectURL(m.image.localUrl);
      if (m.file && m.file.localUrl) URL.revokeObjectURL(m.file.localUrl);
      if (m.voice && m.voice.localUrl) URL.revokeObjectURL(m.voice.localUrl);
    }
  }
}
