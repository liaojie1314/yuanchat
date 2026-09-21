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

/**
 * 演示用头像：内联 SVG data URI
 *
 * @remarks 刻意不引外网图床——mock 模式常在断网/CI 里跑，
 * 外链头像一律加载失败就看不出九宫格的格子与顺序了。
 * 颜色用逗号分隔的 hsl()，旧 WebView 不认空格分隔的新语法。
 */
function demoAvatar(label: string, hue: number): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" fill="hsl(' +
    hue +
    ', 58%, 55%)"/>' +
    '<text x="32" y="43" font-size="30" text-anchor="middle" fill="#fff">' +
    label +
    "</text></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/**
 * 生成 n 个演示成员头像（服务端最多给 9 个，此处同样不超过 9）
 *
 * @param n - 头像个数
 * @param blanks - 这些下标留空串，演示「该成员没设头像」的占位格
 */
function demoMemberAvatars(n: number, blanks: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(blanks.indexOf(i) >= 0 ? "" : demoAvatar(String(i + 1), (i * 41) % 360));
  }
  return out;
}

/** 演示成员昵称池，循环取用；首字用于没设头像的那一格 */
const DEMO_MEMBER_NAMES = ["陈曦", "林墨", "苏晴", "周野", "郑川", "何澜", "吴桐", "秦屿", "叶蓁"];

/**
 * 生成 n 个演示成员昵称，与 {@link demoMemberAvatars} 同序等长
 *
 * @param n - 成员个数（与头像数一致，服务端同样最多给 9 个）
 */
function demoMemberNames(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(DEMO_MEMBER_NAMES[i % DEMO_MEMBER_NAMES.length]);
  }
  return out;
}

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
    pinnedAt: "2026-07-31T09:00:00+08:00",
    mentionedMe: true,
    memberCount: 28,
    // 28 人群：服务端截断到 9 个，九宫格铺满
    memberAvatars: demoMemberAvatars(9, []),
    memberNames: demoMemberNames(9),
    onlineCount: 5,
    pinnedMessage: "周五 15:00 发布评审，请提前更新进度看板",
    announcement: "新人入群请先自我介绍，工作日 10:00-19:00 为核心响应时间，请勿深夜 @全体成员",
    announcementUpdatedAt: "2026-08-01T09:00:00+08:00",
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
    pinnedAt: "2026-07-30T09:00:00+08:00",
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
    // 9 人群：恰好铺满，且第 2、6 位成员没设头像（空串占位，走昵称首字兜底）
    memberAvatars: demoMemberAvatars(9, [1, 5]),
    memberNames: demoMemberNames(9),
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
  {
    // 3 人群：九宫格的少人分支（前端按人数改用 2x2 / 三角等布局）
    id: "7",
    type: "group",
    name: "周末露营",
    lastMessage: "帐篷我带两顶",
    lastTime: "周一",
    unreadCount: 0,
    isMuted: false,
    memberCount: 3,
    memberAvatars: demoMemberAvatars(3, []),
    memberNames: demoMemberNames(3),
  },
  {
    // 10 人群：刚好越过九宫格上限，只给 9 个头像
    id: "8",
    type: "group",
    name: "校友会",
    lastMessage: "下个月聚一次？",
    lastTime: "06-28",
    unreadCount: 0,
    isMuted: false,
    memberCount: 10,
    memberAvatars: demoMemberAvatars(9, [8]),
    memberNames: demoMemberNames(9),
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
      seq: 1,
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
      seq: 2,
    },
    {
      id: "m2",
      conversationId: "1",
      kind: "image",
      isSelf: false,
      senderName: "李四",
      // key 是「添加到表情」的前置条件（气泡菜单项要求 image.key 存在），
      // seq 是「服务端已确认」的标志（isServerConfirmed）——两者缺一，mock 模式下
      // 收藏入口恒不出现，E2E 也就永远测不到这条路径。
      image: { width: 220, height: 140, key: "images/2026/08/deadbeef-0002.png" },
      time: "09:15",
      seq: 3,
    },
    {
      id: "m3",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "看起来不错！发布看板我已经更新到最新，大家可以对照检查各自模块。",
      time: "09:18",
      status: "read",
      seq: 4,
    },
    {
      id: "m4",
      conversationId: "1",
      kind: "voice",
      isSelf: false,
      senderName: "王芳",
      // key 同 m2 的理由：媒体相册按对象 key 聚合，缺 key 的样本在「语音」tab 里恒不出现
      voice: {
        seconds: 12,
        wave: [6, 12, 18, 9, 14, 20, 8, 12, 16, 6],
        key: "files/2026/08/deadbeef-0004.webm",
      },
      time: "09:24",
      seq: 5,
    },
    {
      id: "m5",
      conversationId: "1",
      kind: "file",
      isSelf: true,
      file: {
        name: "发布评审_v3.pdf",
        size: "3.2 MB",
        ext: "PDF",
        key: "files/2026/08/deadbeef-0005.pdf",
      },
      time: "09:26",
      status: "sent",
      seq: 6,
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
      // 「已编辑」角标仅在 editCount > 0 时可点开编辑历史，demo 需要一个可点样本
      editCount: 2,
      seq: 7,
    },
    {
      id: "m7",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "没问题，我改一下日程。",
      time: "14:33",
      // 刻意不给 seq：failed 意味着服务端从未确认，正好作为「引用/转发/收藏入口
      // 应当禁用」的反例样本
      status: "failed",
    },
    {
      id: "m8",
      conversationId: "1",
      kind: "system",
      isSelf: false,
      text: "陈曦 撤回了一条消息",
      time: "14:34",
      seq: 8,
    },
    {
      id: "m9",
      conversationId: "1",
      kind: "video",
      isSelf: false,
      senderName: "李四",
      // 视频气泡与相册「视频」tab 的唯一演示样本：thumbKey 供 poster，key 供播放弹层
      video: {
        duration: 15,
        width: 1280,
        height: 720,
        key: "files/2026/08/deadbeef-0006.mp4",
        thumbKey: "images/2026/08/deadbeef-0007.jpg",
        name: "发布演示.mp4",
        size: "2.0 MB",
      },
      time: "14:36",
      seq: 9,
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
      seq: 1,
    },
    {
      id: "m31",
      conversationId: "3",
      kind: "text",
      isSelf: true,
      text: "已经准备差不多了，PPT 还在完善",
      time: "12:44",
      status: "read",
      seq: 2,
    },
    {
      id: "m32",
      conversationId: "3",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "好的，那就这么定了，辛苦！",
      time: "12:48",
      seq: 3,
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

/**
 * Mock 模式下的群成员（`GET /conversations/:id/members`）。
 *
 * 含「自己」（E2E 夹具与 authStore 用的 `e2e_user`）：成员表本就包含本人，
 * 选人弹窗靠 `m.userId !== selfId` 把自己剔掉，mock 若不带自己就测不到这一步。
 * 其余 4 人是为了让 mesh 上限（自己 + 3 名受邀人）能被真的选满。
 */
export const DEMO_MEMBERS = [
  { user_id: "e2e_user", nickname: "E2E Tester", avatar_url: null, role: 2 },
  { user_id: "u_chenxi", nickname: "陈曦", avatar_url: null, role: 1 },
  { user_id: "u_zhangwei", nickname: "张伟", avatar_url: null, role: 0 },
  { user_id: "u_amy", nickname: "Amy", avatar_url: null, role: 0 },
  { user_id: "u_lina", nickname: "李娜", avatar_url: null, role: 0, alias: "娜娜" },
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
