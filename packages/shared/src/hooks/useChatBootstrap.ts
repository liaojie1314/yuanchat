/**
 * useChatBootstrap — 聊天数据源初始化 Hook
 *
 * @description
 * 在 ChatScreen 挂载时调用一次，按模式接线：
 * - Mock 模式（VITE_ENABLE_MOCK=true）：注入 demo 会话/消息，
 *   sendText 走 setTimeout 模拟回执，不建立任何网络连接
 * - 真实模式：注册 WebSocket 帧处理器 → 拉会话列表 → 建立连接；
 *   重连成功后自动重拉会话列表并清空消息缓存（重新按需加载，防止漏消息）
 *
 * 卸载时断开连接（登出/离开聊天页）。
 */
import { useEffect } from "react";
import i18n from "@yuanchat/design-system/i18n";
import { dateKeyOf, formatListTime, formatMessageTime, mapConversation } from "../api/chat";
import { setTokenProvider } from "../api/client";
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
import { setMessageMockMode, useMessageStore } from "../store/messageStore";
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

      const msg: ChatMessage = {
        id: p.message_id,
        conversationId: p.conversation_id,
        kind: "text",
        isSelf,
        senderName: p.sender_nickname,
        text: p.content.text,
        seq: p.seq,
        time: formatMessageTime(iso),
        dateKey: dateKeyOf(new Date(p.timestamp)),
        status: isSelf ? "sent" : undefined,
        clientMsgId: p.client_msg_id,
      };
      useMessageStore.getState().receiveMessage(msg);

      const convStore = useConversationStore.getState();
      const conv = convStore.conversations.find((c) => c.id === p.conversation_id);
      const preview =
        conv && conv.type === "group" && !isSelf
          ? p.sender_nickname + ": " + p.content.text
          : p.content.text;

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
  });

  chatSocket.onReconnect = () => {
    // 掉线期间可能漏消息：重拉会话列表，清空消息缓存让会话重新按需加载
    useConversationStore.getState().loadConversations();
    useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
    const activeId = useConversationStore.getState().activeId;
    if (activeId) useMessageStore.getState().loadHistory(activeId);
    // 掉线期间可能漏好友申请/同意推送
    void useContactStore.getState().loadRequests();
  };
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
    void useConversationStore.getState().loadConversations();
    // 申请列表随登录拉取（"新的朋友"角标；好友列表进通讯录页再拉）
    void useContactStore.getState().loadRequests();
    chatSocket.connect();

    return () => {
      chatSocket.disconnect();
    };
  }, []);
}
