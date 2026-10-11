import { useBlocklistStore } from "./blocklistStore";
import { useCallStore } from "./callStore";
import { useContactStore } from "./contactStore";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";
import { useMomentsStore } from "./momentsStore";
import { usePresenceStore } from "./presenceStore";
import { resetIceServersCache } from "../webrtc/iceServers";
import { ringtone } from "../webrtc/ringtone";
import { purgeLocalStore } from "../localdb";

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
  // 本地消息库整个删掉：一个账号一个库（库名带 userId），删库即彻底清掉跨账号残留。
  // 刻意 fire-and-forget 而不把本函数改成 async —— 它有多处同步调用方。
  // 删库是幂等的，且即使删除还在进行中也不会读到旧账号数据：
  // 下次 initLocalStore 开的是另一个库名，两者本来就不是同一个库。
  void purgeLocalStore();
}

/**
 * 遍历所有会话消息，撤销未清理的本地 blob 预览 URL（图片 + 文件 + 语音 + 视频）。
 *
 * @param keepUnconfirmed - 为 true 时跳过未被服务端确认（无 seq）的消息。
 *
 * @remarks
 * 这个参数不是可选的优化，是正确性要求。未确认的消息（sending / failed）**只存在于
 * 内存**，重发必须靠 `localUrl` 取回原始字节；一旦 revoke，重试里的 `fetch(localUrl)`
 * 必抛 —— 线上表现就是「点重试毫无反应」。
 * 登出（{@link resetChatStores}）要全清，那时连消息本身都不留；
 * 重连对账只该清掉能从服务端重新拉回来的那部分。
 */
export function revokeAllLocalPreviews(keepUnconfirmed = false): void {
  if (typeof URL === "undefined" || !URL.revokeObjectURL) return;
  const byConv = useMessageStore.getState().messagesByConv;
  for (const list of Object.values(byConv)) {
    for (const m of list) {
      if (keepUnconfirmed && typeof m.seq !== "number") continue;
      if (m.image && m.image.localUrl) URL.revokeObjectURL(m.image.localUrl);
      if (m.file && m.file.localUrl) URL.revokeObjectURL(m.file.localUrl);
      if (m.voice && m.voice.localUrl) URL.revokeObjectURL(m.voice.localUrl);
      // 视频载荷同样有 localUrl，漏掉它这段 blob 到进程退出才释放
      if (m.video && m.video.localUrl) URL.revokeObjectURL(m.video.localUrl);
    }
  }
}

/**
 * 只保留未被服务端确认的消息，其余缓存清掉（重连对账用）。
 *
 * @remarks
 * 重连后要重拉历史，但不能整体 `messagesByConv: {}` —— 那会把用户没发出去的
 * sending / failed 一起抹掉，用户眼里就是「断网时发的东西来网后凭空消失」。
 * 服务端有的消息清掉无所谓（`loadHistory` 会拉回来），服务端没有的必须留。
 */
export function keepOnlyUnconfirmed(): void {
  const byConv = useMessageStore.getState().messagesByConv;
  const kept: typeof byConv = {};
  for (const [convId, list] of Object.entries(byConv)) {
    const unconfirmed = list.filter((m) => typeof m.seq !== "number");
    if (unconfirmed.length > 0) kept[convId] = unconfirmed;
  }
  useMessageStore.setState({ messagesByConv: kept, hasMoreByConv: {} });
}
