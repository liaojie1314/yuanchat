/**
 * useChatBootstrap — 聊天数据源初始化 Hook
 *
 * @description
 * 在 MainLayout（登录后布局层）挂载时调用一次，按模式接线：
 * - Mock 模式（VITE_ENABLE_MOCK=true）：注入 demo 会话/消息，
 *   sendText 走 setTimeout 模拟回执，不建立任何网络连接
 * - 真实模式：注册 WebSocket 帧处理器 → 拉会话列表 + presence 快照 → 建立连接；
 *   重连成功后自动重拉会话列表并清空消息缓存（重新按需加载，防止漏消息）
 *
 * 挂在布局层保证聊天/通讯录/设置切页不断连（presence、消息帧全程可达）；
 * 登出（布局卸载）时断开连接。
 */
import { useEffect } from "react";
import i18n from "@yuanchat/design-system/i18n";
import {
  dateKeyOf,
  formatFileMeta,
  formatListTime,
  formatMessageTime,
  mapConversation,
  pseudoWave,
} from "../api/chat";
import { setTokenProvider } from "../api/client";
import { fetchPresence } from "../api/presence";
import { notifyIncoming } from "../notify";
import {
  DEMO_CONVERSATIONS,
  DEMO_FRIENDS,
  DEMO_MESSAGES,
  DEMO_REQUESTS,
  DEMO_TYPING,
} from "../mocks/demoData";
import { useAuthStore } from "../store/authStore";
import { useContactStore } from "../store/contactStore";
import { useConversationStore } from "../store/conversationStore";
import type { Conversation } from "../store/conversationStore";
import { setE2EEContext, setMessageMockMode, useMessageStore } from "../store/messageStore";
import { decryptFrom } from "../crypto/e2eeManager";
import { usePresenceStore } from "../store/presenceStore";
import { resetChatStores, revokeAllLocalPreviews } from "../store/resetStores";
import { showToast } from "../store/toastStore";
import type { ChatMessage } from "../store/messageStore";
import { chatSocket } from "../ws/chatSocket";

interface ImportMetaEnv {
  VITE_ENABLE_MOCK?: string;
}

export function isMockEnabled(): boolean {
  if (typeof import.meta === "undefined") return false;
  const env = (import.meta as { env?: ImportMetaEnv }).env;
  return !!env && env.VITE_ENABLE_MOCK === "true";
}

/** 帧处理器只需注册一次（模块级防重） */
let wired = false;

function wireSocket() {
  if (wired) return;
  wired = true;

  setTokenProvider(() => useAuthStore.getState().accessToken);
  chatSocket.setTokenProvider(() => useAuthStore.getState().accessToken);

  // E2EE 上下文：仅单聊有对端 id，群聊返回 undefined 即整体走明文
  //（群聊 E2EE 需 Sender Key 方案，v1.1 再做）
  setE2EEContext(
    () => useAuthStore.getState().user?.id,
    (conversationId) => {
      const conv = useConversationStore
        .getState()
        .conversations.find((c) => c.id === conversationId);
      return conv?.type === "private" ? conv.peerId : undefined;
    },
  );

  chatSocket.setHandlers({
    "message.ack": (p) => {
      useMessageStore
        .getState()
        .applyAck(p.client_msg_id, p.message_id, p.conversation_id, p.seq, p.timestamp);
      useConversationStore
        .getState()
        .updateConversation(p.conversation_id, { lastSeq: p.seq, myLastReadSeq: p.seq });
    },

    "message.receive": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      const isSelf = p.sender_id === selfId;
      const iso = new Date(p.timestamp).toISOString();

      // E2EE 密文：就地解密后按普通文本消息渲染。
      // 自己发的密文无需解密（本端已有明文乐观条目，且棘轮状态不含
      // 自己发送链的解密密钥）；解密失败降级为占位提示，不丢消息。
      if (p.content.type === "e2ee") {
        if (isSelf) return;
        const outcome = decryptFrom(selfId, p.sender_id, {
          type: "e2ee",
          ratchet_key: p.content.ratchet_key ?? "",
          n: p.content.n ?? 0,
          pn: p.content.pn ?? 0,
          nonce: p.content.nonce ?? "",
          ciphertext: p.content.ciphertext ?? "",
          identity_key: p.content.identity_key,
          ephemeral_key: p.content.ephemeral_key,
          otk_id: p.content.otk_id,
        });
        p = {
          ...p,
          content: {
            type: "text",
            text: outcome.ok ? outcome.text : i18n.t("e2ee.undecryptable"),
          },
        };
      }

      const isImage = p.content.type === "image";
      const isSystem = p.content.type === "system";
      const isFile = p.content.type === "file";
      const isVoice = p.content.type === "voice";

      const kind: ChatMessage["kind"] = isSystem
        ? "system"
        : isImage
          ? "image"
          : isFile
            ? "file"
            : isVoice
              ? "voice"
              : "text";
      const msg: ChatMessage = {
        id: p.message_id,
        conversationId: p.conversation_id,
        kind,
        isSelf,
        senderName: p.sender_nickname,
        text: kind === "text" || kind === "system" ? p.content.text : undefined,
        image: isImage
          ? { key: p.content.key, width: p.content.width ?? 0, height: p.content.height ?? 0 }
          : undefined,
        file: isFile
          ? {
              name: p.content.name ?? "",
              ...formatFileMeta(p.content.name ?? "", p.content.size ?? 0),
              key: p.content.key,
            }
          : undefined,
        voice: isVoice
          ? {
              seconds: p.content.duration ?? 0,
              wave: pseudoWave(p.content.duration ?? 0),
              key: p.content.key,
            }
          : undefined,
        seq: p.seq,
        time: formatMessageTime(iso),
        dateKey: dateKeyOf(new Date(p.timestamp)),
        createdAtMs: p.timestamp,
        status: isSelf && !isSystem ? "sent" : undefined,
        clientMsgId: p.client_msg_id,
        replyToId: p.reply_to_id,
        mentions: p.mentions,
      };
      useMessageStore.getState().receiveMessage(msg);

      const convStore = useConversationStore.getState();
      const conv = convStore.conversations.find((c) => c.id === p.conversation_id);
      // 图片/文件/语音消息列表预览走占位文案；文本/系统消息用正文
      const body = isImage
        ? i18n.t("chat.message.image")
        : isFile
          ? i18n.t("chat.message.file")
          : isVoice
            ? i18n.t("chat.message.voice")
            : (p.content.text ?? "");
      // system 消息不加昵称前缀
      const preview =
        conv && conv.type === "group" && !isSelf && !isSystem
          ? p.sender_nickname + ": " + body
          : body;

      if (isSelf) {
        // 自己发的消息（本设备或其他设备）：只刷新预览，不加未读
        convStore.updateConversation(p.conversation_id, {
          lastMessage: preview,
          lastTime: formatListTime(iso),
          lastSeq: p.seq,
        });
        return;
      }

      convStore.applyIncoming(p.conversation_id, preview, formatListTime(iso), p.seq);
      // 系统通知：失焦 + 非免打扰时弹（桌面端注入 Tauri 实现，web 端静默）
      if (conv) notifyIncoming({ name: conv.name, isMuted: conv.isMuted }, preview);

      // 被 @ 且非当前活跃会话：置 mentionUnread 供列表红点（进入会话时 clearUnread 自动清零）
      const selfIdNow = useAuthStore.getState().user?.id;
      const mentionedMe = !!(selfIdNow && p.mentions?.includes(selfIdNow));
      if (mentionedMe && convStore.activeId !== p.conversation_id) {
        convStore.markMentioned(p.conversation_id);
      }

      // 正在看这个会话：立即上报已读
      if (convStore.activeId === p.conversation_id) {
        chatSocket.send("message.read", { conversation_id: p.conversation_id, seq: p.seq });
        convStore.updateConversation(p.conversation_id, { myLastReadSeq: p.seq });
      }
    },

    "message.read": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      if (p.user_id === selfId) {
        // 自己其他设备读了：同步未读清零
        useConversationStore.getState().updateConversation(p.conversation_id, {
          unreadCount: 0,
          myLastReadSeq: p.seq,
        });
        return;
      }
      // 对方读了：把自己已送达的消息翻成已读
      useMessageStore.getState().applyRead(p.conversation_id, p.seq);
    },

    "message.recalled": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      useMessageStore.getState().applyRecall(p.conversation_id, p.message_id, p.operator_nickname);
      const convStore = useConversationStore.getState();
      const conv = convStore.conversations.find((c) => c.id === p.conversation_id);
      // 撤回的是最后一条时刷新列表预览
      if (conv && conv.lastSeq === p.seq) {
        convStore.updateConversation(p.conversation_id, {
          lastMessage: i18n.t(
            p.operator_id === selfId ? "chat.message.revokedBySelf" : "chat.message.revokedBy",
            { name: p.operator_nickname },
          ),
        });
      }
    },

    typing: (p) => {
      useMessageStore.getState().setTyping(p.conversation_id, p.nickname);
    },

    "message.reaction": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      useMessageStore
        .getState()
        .applyReaction(
          p.conversation_id,
          p.message_id,
          p.emoji,
          p.count,
          p.user_id === selfId ? p.reacted : undefined,
        );
    },

    "contact.request": (p) => {
      useContactStore.getState().applyIncomingRequest({
        id: p.request_id,
        direction: "in",
        status: 0,
        message: p.message || "",
        peer: {
          id: p.requester.id,
          nickname: p.requester.nickname,
          avatarUrl: p.requester.avatar_url,
          shortId: p.requester.short_id,
        },
        updatedAt: new Date(p.created_at).toISOString(),
      });
    },

    "contact.accepted": (p) => {
      useContactStore.getState().applyAccepted(
        p.request_id,
        {
          id: p.friend.id,
          nickname: p.friend.nickname,
          avatarUrl: p.friend.avatar_url,
          shortId: p.friend.short_id,
        },
        p.conversation_id,
      );
    },

    "conversation.created": (p) => {
      const conv = mapConversation(p.conversation);
      const convStore = useConversationStore.getState();
      // 发起者已由 POST 响应把会话插入本地：按 id 去重，避免帧重复冒出
      if (convStore.conversations.some((c) => c.id === conv.id)) return;
      convStore.addConversation(conv);
    },

    "conversation.updated": (p) => {
      const patch: Partial<Conversation> = {};
      if (p.name) patch.name = p.name;
      if (p.member_count) patch.memberCount = p.member_count;
      useConversationStore.getState().updateConversation(p.conversation_id, patch);
    },

    "conversation.removed": (p) => {
      useConversationStore.getState().removeConversation(p.conversation_id);
      if (p.reason === "kicked") showToast("info", i18n.t("chat.group.kickedNotice"));
      else if (p.reason === "dissolved") showToast("info", i18n.t("chat.group.dissolvedNotice"));
    },

    "conversation.role_changed": (p) => {
      useConversationStore.getState().applyRoleChanged(p.conversation_id);
      // 只对"别人对我"的角色变更 toast（自己发起的操作由 UI 层反馈；系统消息帧另行入流）
      const selfId = useAuthStore.getState().user?.id;
      if (p.user_id !== selfId || p.changed_by === selfId) return;
      if (p.new_role === 2) showToast("info", i18n.t("group.becameOwnerToast"));
      else if (p.new_role === 1) showToast("info", i18n.t("group.becameAdminToast"));
      else showToast("info", i18n.t("group.revokedAdminToast"));
    },

    "friend.removed": (p) => {
      useContactStore.getState().removeFriend(p.friend_id);
    },

    error: (p) => {
      // BLOCKED：单聊被拉黑拒发。把对应乐观消息翻 failed + toast 提示
      if (p.message === "BLOCKED" && p.client_msg_id) {
        useMessageStore.getState().failByClientMsgId(p.client_msg_id);
        showToast("error", i18n.t("chat.message.blockedRejected"));
      }
    },

    presence: (p) => {
      useConversationStore.getState().applyPresence(p.user_id, p.online);
      usePresenceStore.getState().applyPresence(p.user_id, p.online);
    },
  });

  chatSocket.onReconnect = () => {
    // 掉线期间可能漏消息：重拉会话列表，清空消息缓存让会话重新按需加载。
    // 快照串在列表加载之后（applyPresenceSnapshot 按 peerId 匹配，须先有列表）
    void useConversationStore
      .getState()
      .loadConversations()
      .then(() => fetchPresence())
      .then((ids) => {
        useConversationStore.getState().applyPresenceSnapshot(ids);
        usePresenceStore.getState().applySnapshot(ids);
      })
      .catch(() => {});
    revokeAllLocalPreviews();
    useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
    const activeId = useConversationStore.getState().activeId;
    if (activeId) useMessageStore.getState().loadHistory(activeId);
    // 掉线期间可能漏好友申请/同意推送
    void useContactStore.getState().loadRequests();
  };

  // 登出（isAuthenticated true→false）时回收 blob 并清空聊天 store，防跨账号残留
  useAuthStore.subscribe((s, prev) => {
    if (prev.isAuthenticated && !s.isAuthenticated) resetChatStores();
  });
}

/** 演示数据注入（幂等：列表已有数据时跳过） */
function injectDemoData() {
  setMessageMockMode(true);
  if (useConversationStore.getState().conversations.length === 0) {
    useConversationStore.setState({ conversations: DEMO_CONVERSATIONS });
  }
  const msgState = useMessageStore.getState();
  if (Object.keys(msgState.messagesByConv).length === 0) {
    // demo 消息无 created_at，统一按"今天"补 dateKey，保证分隔线正常渲染
    const todayKey = dateKeyOf(new Date());
    const withDateKey: Record<string, ChatMessage[]> = {};
    for (const [convId, list] of Object.entries(DEMO_MESSAGES)) {
      withDateKey[convId] = list.map((m) => ({ ...m, dateKey: todayKey }));
    }
    useMessageStore.setState({ messagesByConv: withDateKey, typingByConv: DEMO_TYPING });
  }
  if (useContactStore.getState().friends.length === 0) {
    useContactStore.setState({ friends: DEMO_FRIENDS, requests: DEMO_REQUESTS });
  }
}

export function useChatBootstrap() {
  useEffect(() => {
    if (isMockEnabled()) {
      injectDemoData();
      return;
    }

    wireSocket();
    // 快照串在列表加载之后（applyPresenceSnapshot 按 peerId 匹配，须先有列表）
    void useConversationStore
      .getState()
      .loadConversations()
      .then(() => fetchPresence())
      .then((ids) => {
        useConversationStore.getState().applyPresenceSnapshot(ids);
        usePresenceStore.getState().applySnapshot(ids);
      })
      .catch(() => {});
    // 申请列表随登录拉取（"新的朋友"角标；好友列表进通讯录页再拉）
    void useContactStore.getState().loadRequests();
    chatSocket.connect();

    return () => {
      chatSocket.disconnect();
    };
  }, []);
}
