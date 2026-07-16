/**
 * Mock 模式演示数据
 *
 * @description
 * 无后端时（VITE_ENABLE_MOCK=true）由 useChatBootstrap 注入 store，
 * 保证三端 UI 演示不退化。数据形态覆盖原型的全部气泡与列表状态。
 */
import type { Friend, FriendRequestItem } from "../api/contacts";
import type { Conversation } from "../store/conversationStore";
import type { ChatMessage } from "../store/messageStore";

export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "1",
    type: "group",
    name: "产品研发群",
    lastMessage: "陈曦：发布评审改到明早 9 点",
    lastTime: "14:32",
    unreadCount: 3,
    isMuted: false,
    isPinned: true,
    mentionedMe: true,
    memberCount: 28,
    onlineCount: 5,
    pinnedMessage: "周五 15:00 发布评审，请提前更新进度看板",
  },
  {
    id: "2",
    type: "private",
    name: "李四",
    lastMessage: "[图片] 这是设计稿的第二版",
    lastTime: "13:05",
    unreadCount: 0,
    isOnline: true,
    presence: "away",
    isMuted: true,
    isPinned: true,
  },
  {
    id: "3",
    type: "private",
    name: "张伟",
    lastMessage: "好的，那就这么定了，辛苦！",
    lastTime: "12:48",
    unreadCount: 1,
    isOnline: true,
    presence: "online",
    isMuted: false,
  },
  {
    id: "4",
    type: "group",
    name: "设计组",
    lastMessage: "图标规范我下午整理一份",
    lastTime: "昨天",
    unreadCount: 0,
    isMuted: false,
    draft: "图标规范我下午整理一份",
    memberCount: 9,
  },
  {
    id: "5",
    type: "private",
    name: "王芳",
    lastMessage: "[语音] 0'15\"",
    lastTime: "周三",
    unreadCount: 0,
    isOnline: false,
    presence: "offline",
    isMuted: false,
  },
  {
    id: "6",
    type: "private",
    name: "元聊助手",
    lastMessage: "🤖 已为你总结 3 条未读消息",
    lastTime: "06-30",
    unreadCount: 0,
    isMuted: false,
  },
];

/** 产品研发群的演示消息流（覆盖全部气泡形态，与原型一致） */
export const DEMO_MESSAGES: Record<string, ChatMessage[]> = {
  "1": [
    {
      id: "m0",
      conversationId: "1",
      kind: "system",
      isSelf: false,
      text: "会话加密已开启 🔒",
      time: "09:00",
    },
    {
      id: "m1",
      conversationId: "1",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "早上好各位，今天的 @全体成员 同步一下发布准备情况",
      mentions: ["@全体成员"],
      time: "09:02",
    },
    {
      id: "m2",
      conversationId: "1",
      kind: "image",
      isSelf: false,
      senderName: "李四",
      image: { width: 220, height: 140 },
      time: "09:15",
    },
    {
      id: "m3",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "看起来不错！发布看板我已经更新到最新，大家可以对照检查各自模块。",
      time: "09:18",
      status: "read",
    },
    {
      id: "m4",
      conversationId: "1",
      kind: "voice",
      isSelf: false,
      senderName: "王芳",
      voice: { seconds: 12, wave: [6, 12, 18, 9, 14, 20, 8, 12, 16, 6] },
      time: "09:24",
    },
    {
      id: "m5",
      conversationId: "1",
      kind: "file",
      isSelf: true,
      file: { name: "发布评审_v3.pdf", size: "3.2 MB", ext: "PDF" },
      time: "09:26",
      status: "sent",
    },
    {
      id: "m6",
      conversationId: "1",
      kind: "text",
      isSelf: false,
      senderName: "陈曦",
      text: "收到，我这边接口联调今天能完成。@你 发布评审改到明早 9 点方便吗？",
      mentions: ["@你"],
      quote: { senderName: "我", excerpt: "发布看板我已经更新到最新…" },
      reactions: [
        { emoji: "👍", count: 2, mine: true },
        { emoji: "🎉", count: 1 },
      ],
      time: "14:32",
      edited: true,
    },
    {
      id: "m7",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "没问题，我改一下日程。",
      time: "14:33",
      status: "failed",
    },
    {
      id: "m8",
      conversationId: "1",
      kind: "system",
      isSelf: false,
      text: "陈曦 撤回了一条消息",
      time: "14:34",
    },
  ],
  "3": [
    {
      id: "m30",
      conversationId: "3",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "你好，明天的会议准备得怎么样了？",
      time: "12:40",
    },
    {
      id: "m31",
      conversationId: "3",
      kind: "text",
      isSelf: true,
      text: "已经准备差不多了，PPT 还在完善",
      time: "12:44",
      status: "read",
    },
    {
      id: "m32",
      conversationId: "3",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "好的，那就这么定了，辛苦！",
      time: "12:48",
    },
  ],
};

/** Mock 模式下"陈曦正在输入"演示 */
export const DEMO_TYPING: Record<string, string> = { "1": "陈曦" };

/** Mock 模式下的好友列表（覆盖中英文昵称的字母分组） */
export const DEMO_FRIENDS: Friend[] = [
  { id: "u_chenxi", nickname: "陈曦", avatarUrl: null, shortId: 10011, conversationId: "1" },
  { id: "u_zhangwei", nickname: "张伟", avatarUrl: null, shortId: 10012, conversationId: "3" },
  { id: "u_bob", nickname: "Bob", avatarUrl: null, shortId: 10002, conversationId: null },
  { id: "u_amy", nickname: "Amy", avatarUrl: null, shortId: 10021, conversationId: null },
  { id: "u_lina", nickname: "李娜", avatarUrl: null, shortId: 10022, conversationId: null },
];

/** Mock 模式下的好友申请（1 条待处理 + 1 条我发出的） */
export const DEMO_REQUESTS: FriendRequestItem[] = [
  {
    id: "fr_demo_1",
    direction: "in",
    status: 0,
    message: "我是 Carol，产品研发群里加个好友～",
    peer: { id: "u_carol", nickname: "Carol", avatarUrl: null, shortId: 10003 },
    updatedAt: new Date().toISOString(),
  },
  {
    id: "fr_demo_2",
    direction: "out",
    status: 0,
    message: "你好，我是元聊用户",
    peer: { id: "u_david", nickname: "David", avatarUrl: null, shortId: 10031 },
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  },
];
