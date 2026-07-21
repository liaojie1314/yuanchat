import { useContactStore } from "./contactStore";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";

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
