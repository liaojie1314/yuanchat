/**
 * MSW Mock 接口处理器
 *
 * @description
 * 开发阶段拦截 API 请求返回模拟数据。
 * 覆盖场景：正常数据、空数据、错误数据、模拟延迟。
 *
 * 处理函数使用 MSW v2 的 http + HttpResponse API。
 *
 * @see https://mswjs.io/docs/
 */
import { http, HttpResponse, passthrough, delay } from "msw";
import { DEMO_FRIENDS, DEMO_MESSAGES } from "./demoData";
import type { ChatMessage, ChatMessageKind } from "../store/messageStore";

// ========================================
// Mock 数据
// ========================================

interface MockUser {
  id: string;
  nickname: string;
  avatar_url: string | null;
  phone: string;
  email: string;
  short_id: number;
}

const MOCK_USER: MockUser = {
  id: "user_001",
  nickname: "元聊用户",
  avatar_url: null,
  phone: "13800138000",
  email: "user@yuanchat.com",
  short_id: 10001,
};

// ========================================
// Captcha SVG 生成
// ========================================

/** 生成随机验证码文本（4 位字母数字混合，排除易混淆字符） */
function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** 随机 hsl 颜色（指定色相范围和饱和度/亮度） */
function randomColor(hRange: [number, number] = [200, 260], s = 50, l = 45): string {
  const h = hRange[0] + Math.random() * (hRange[1] - hRange[0]);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * 生成美观的验证码 SVG
 *
 * 每次调用生成不同的随机验证码，
 * 包含背景噪点、干扰线、旋转字符，模拟真实验证码的视觉风格。
 */
function generateCaptchaSvg(): string {
  const W = 140;
  const H = 48;
  const code = randomCode();
  const charWidth = W / (code.length + 1); // 字符间距
  const fontSize = 22;

  // 噪点（背景小圆点）
  let noiseDots = "";
  for (let i = 0; i < 18; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    const r = 0.6 + Math.random() * 1.2;
    noiseDots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${randomColor([200, 260], 40, 60)}" opacity="${0.15 + Math.random() * 0.2}"/>`;
  }

  // 干扰线
  let noiseLines = "";
  for (let i = 0; i < 3; i++) {
    const x1 = Math.random() * W * 0.5;
    const y1 = 6 + Math.random() * (H - 12);
    const x2 = W * 0.4 + Math.random() * W * 0.6;
    const y2 = 6 + Math.random() * (H - 12);
    noiseLines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randomColor([200, 240], 35, 55)}" stroke-width="${0.8 + Math.random() * 1.2}" opacity="0.35"/>`;
  }

  // 字符（每个字符独立旋转 + 轻微垂直偏移）
  let chars = "";
  for (let i = 0; i < code.length; i++) {
    const x = charWidth * 0.6 + i * charWidth;
    const y = 32 + (Math.random() - 0.5) * 6; // 垂直随机偏移 ±3px
    const rotate = (Math.random() - 0.5) * 24; // 旋转 ±12°
    const col = randomColor([210, 250], 45, 35);
    chars += `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" fill="${col}" transform="rotate(${rotate}, ${x}, ${y})">${code[i]}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" rx="10"/>
  <rect width="${W}" height="${H}" fill="none" stroke="#e2e8f0" stroke-width="1" rx="10"/>
  ${noiseDots}
  ${noiseLines}
  ${chars}
  <line x1="8" y1="10" x2="${W - 8}" y2="${H - 10}" stroke="${randomColor([200, 250], 30, 65)}" stroke-width="0.7" opacity="0.25"/>
</svg>`;
}

// ========================================
// A8 认证补全链路的 Mock 常量与可变状态
// ========================================

/** 唯一被接受的验证码；其余一律回 auth.otpWrong 且不消耗验证码 */
const MOCK_OTP_CODE = "123456";
/** 该手机号用于演示 60 秒冷却分支 */
const MOCK_COOLDOWN_PHONE = "13800138001";
const MOCK_RESET_TICKET = "mock-reset-ticket";
const MOCK_QR_TOKEN = "mock-qr-token";
/** 轮询密钥：只在建会话响应里给出，不进二维码内容 */
const MOCK_QR_POLL_SECRET = "mock-qr-poll-secret";
/** 会话存活秒数，与服务端 expires_in 同义（秒） */
const MOCK_QR_TTL_SECONDS = 120;

/** 票据是否已被消费，用于验证单次消费语义 */
let mockResetTicketUsed = false;
/** 轮询次数，驱动 pending → scanned → confirmed 的状态推进 */
let mockQrPollCount = 0;
/** 令牌是否已被取走，取走后会话即销毁（再轮询回 404） */
let mockQrTokensClaimed = false;
/** 扫码端是否已取消；canceled 是终态，会话仍在但轮询只回该状态 */
let mockQrCanceled = false;

// ========================================
// 辅助函数
// ========================================

function apiOk<T>(data: T) {
  return HttpResponse.json({ code: 0, message: "ok", data });
}

function apiError(code: number, message: string) {
  return HttpResponse.json({ code, message, data: null }, { status: code >= 500 ? 500 : 400 });
}

/**
 * 决定是否拦截当前请求：
 * - 后端可用时（localhost:8085 可达）→ 放行（passthrough）
 * - 后端不可用 → Mock 接管
 *
 * 注意：MSW passthrough 在 Service Worker 层面实现，
 * 这里直接返回 mock 数据即可。如果需要切换真实后端，
 * 将 VITE_ENABLE_MOCK=false 或直接关闭 MSW。
 */

// ========================================
// 贴纸 Mock 状态（进程内可变，模拟"收藏/删除立即生效"）
// ========================================

/** 贴纸 mock 数据形状（与 api/stickers.ts 的 StickerItem 对齐）。 */
interface MockSticker {
  id: string;
  object_key: string;
  width: number;
  height: number;
  /** 去重键，仅 mock 内部使用（真实接口不返回） */
  content_hash?: string;
}

/**
 * 生成一张可直接渲染的内联 SVG 贴纸。
 *
 * @remarks mock 模式下没有 MinIO，`/files/download-url` 返回 data URL 即可让
 *   `<img>` 真的出图——否则 StickerThumb/StickerImage 一律走 error 分支显示破图，
 *   E2E 也就没法验证"贴纸网格里有可点的贴纸"。
 */
function stickerDataUrl(key: string): string {
  // 由 key 派生色相，让不同贴纸在演示与截图里看起来不同
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="hsl(${hash}, 70%, 88%)"/><circle cx="36" cy="40" r="6" fill="hsl(${hash}, 60%, 30%)"/><circle cx="60" cy="40" r="6" fill="hsl(${hash}, 60%, 30%)"/><path d="M32 60 Q48 74 64 60" stroke="hsl(${hash}, 60%, 30%)" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/**
 * 约 1 毫秒静音单声道 8kHz 8bit WAV 的 data URL（44 字节头 + 8 个静音采样，共 52 字节）。
 *
 * @remarks 供 mock 模式的语音/视频占位，使播放器能成功 decode 而不报错。
 *   刻意取最短长度：只为让 `<audio>`/`<video>` 走通 loadeddata，不承载可听内容。
 */
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";

/**
 * 按对象 key 的后缀给出可用的 data URL。
 *
 * @remarks mock 模式没有 MinIO，此前对任何 key 都回内联 SVG，导致点播 demo
 *   语音/视频时 `<audio>`/`<video>` 拿到图片必然报错、toast「播放失败」。
 *   这里按后缀分派：音频给一段极短的静音 WAV，视频暂时也给静音音频
 *   （只为让播放器不报错，演示中不会有画面），其余仍给 SVG 贴纸。
 *   data URL 均为占位，不是真实媒体内容。
 */
function mockObjectDataUrl(key: string): string {
  const lower = key.toLowerCase();
  const isAudio =
    lower.indexOf(".webm") >= 0 ||
    lower.indexOf(".mp3") >= 0 ||
    lower.indexOf(".m4a") >= 0 ||
    lower.indexOf(".wav") >= 0;
  const isVideo = lower.indexOf(".mp4") >= 0 || lower.indexOf(".mov") >= 0;
  if (isAudio || isVideo) return SILENT_WAV_DATA_URL;
  return stickerDataUrl(key);
}

/** 官方表情包（唯一一个，8 张，与后端 seed 的规模一致）。 */
const MOCK_PACK_STICKERS: MockSticker[] = Array.from({ length: 8 }, (_, i) => ({
  id: "pack_sticker_" + (i + 1),
  object_key: "images/2026/08/0f5a1c00-000" + (i + 1) + ".svg",
  width: 96,
  height: 96,
}));

/**
 * 本人收藏（可被 POST/DELETE 改动；预置 2 张让"收藏 tab 非空"可测）。
 *
 * @remarks MSW browser 模式下 handler 在页面上下文求值，故这份状态随页面重载复位——
 *   E2E 各用例天然隔离，无需显式 reset 钩子。
 */
let mockMyStickers: MockSticker[] = [
  {
    id: "fav_sticker_1",
    object_key: "images/2026/08/beef0001-0001.svg",
    width: 96,
    height: 96,
    content_hash: "a".repeat(64),
  },
  {
    id: "fav_sticker_2",
    object_key: "images/2026/08/beef0001-0002.svg",
    width: 96,
    height: 96,
    content_hash: "b".repeat(64),
  },
];

// ========================================
// 收藏 Mock 状态（进程内可变，模拟「收藏/取消立即生效」）
// ========================================

/** 收藏条目 mock 形状（与 api/favorites.ts 的 FavoriteItem 对齐）。 */
interface MockFavorite {
  id: string;
  message_id: string;
  conversation_id: string;
  conv_name: string;
  sender_nickname: string;
  /** 1=文字 2=图片 3=文件 4=语音 */
  message_type: number;
  /** 与消息 content 同构的 JSON 字符串 */
  content: string;
  created_at: string;
}

/**
 * 预置收藏（文字/图片/文件/语音各一条，四个筛选 tab 都有内容可看）。
 *
 * @remarks 收藏端点此前没有 mock，请求会顺着兜底 passthrough 打到真实后端：
 *   后端在跑时 mock 模式的假 token 换回 401 → 触发强制刷新 → 仍 401 → 清登录态，
 *   于是「打开收藏页就被踢回登录页」。mock 模式必须自成闭环，不依赖后端在不在。
 */
let mockFavorites: MockFavorite[] = [
  {
    id: "fav_1",
    message_id: "msg_fav_0001",
    conversation_id: "1",
    conv_name: "产品研发群",
    sender_nickname: "张伟",
    message_type: 1,
    content: JSON.stringify({ text: "发布评审改到明早 9 点，记得提前十分钟到会议室。" }),
    created_at: "2026-08-20T09:02:00+08:00",
  },
  {
    id: "fav_2",
    message_id: "msg_fav_0002",
    conversation_id: "1",
    conv_name: "产品研发群",
    sender_nickname: "李四",
    message_type: 2,
    content: JSON.stringify({
      key: "images/2026/08/deadbeef-0002.png",
      width: 220,
      height: 140,
    }),
    created_at: "2026-08-19T15:40:00+08:00",
  },
  {
    id: "fav_3",
    message_id: "msg_fav_0003",
    conversation_id: "2",
    conv_name: "李四",
    sender_nickname: "李四",
    message_type: 3,
    content: JSON.stringify({ name: "需求评审记录.pdf", size: 402_311 }),
    created_at: "2026-08-18T11:05:00+08:00",
  },
  {
    id: "fav_4",
    message_id: "msg_fav_0004",
    conversation_id: "2",
    conv_name: "李四",
    sender_nickname: "李四",
    message_type: 4,
    content: JSON.stringify({ key: "audio/2026/08/deadbeef-0004.webm", duration: 6 }),
    created_at: "2026-08-17T20:12:00+08:00",
  },
];

/** 测试辅助：剥掉仅 mock 内部使用的 content_hash，保持响应形状与真实接口一致。 */
function toStickerDTO(s: MockSticker) {
  return { id: s.id, object_key: s.object_key, width: s.width, height: s.height };
}

// ========================================
// 表情商城 Mock 状态（商城/发布/编辑，进程内可变）
// ========================================

/** 商城表情包 mock 形状（字段与 service 层各 DTO 投影对齐）。 */
interface MockPack {
  id: string;
  name: string;
  cover_url: string | null;
  owner_name: string | null;
  is_official: boolean;
  /** 是否在商城公开（官方包恒可见；发布即公开，本 mock 无草稿态） */
  is_public: boolean;
  /** 相对 mock 用户的归属（is_owner 判定用） */
  published_by_me: boolean;
  flagged: boolean;
  taken_down: boolean;
  created_at: string;
  stickers: MockSticker[];
}

/**
 * 商城预置：官方包 + 24 个演示用户包。
 *
 * @remarks 24 个是为了让默认页大小 20 之下必然出现 next_cursor，
 *   E2E 能直接验证游标分页与「加载更多」。created_at 全部唯一且倒序生成，
 *   与服务端 created_at DESC + 游标语义一致。发布上限 20 也能自然触发：
 *   mock 用户从 0 个起发，连发 20 个后回 400 + 业务码 4003 `publish limit exceeded`。
 */
const MARKET_SEED_COUNT = 24;

/** 演示发布者昵称池（轮转取用，让商城列表看起来有多人发布） */
const MARKET_OWNERS = ["阿明", "阿珍", "小北", "柚子"];

function seedMarketPacks(): MockPack[] {
  const baseMs = Date.UTC(2026, 7, 30, 12, 0, 0); // 2026-08-30T12:00:00Z
  const packs: MockPack[] = [];
  for (let i = 0; i < MARKET_SEED_COUNT; i++) {
    const id = "pack_market_" + String(i + 1).padStart(2, "0");
    const stickers: MockSticker[] = Array.from({ length: 6 }, (_, j) => ({
      id: id + "_s" + (j + 1),
      object_key: "images/2026/07/beef0002-" + String(i + 1).padStart(2, "0") + (j + 1) + ".svg",
      width: 96,
      height: 96,
    }));
    packs.push({
      id,
      name: "演示表情包 " + (i + 1),
      cover_url: stickerDataUrl("cover-" + id),
      owner_name: MARKET_OWNERS[i % MARKET_OWNERS.length],
      is_official: false,
      is_public: true,
      published_by_me: false,
      flagged: false,
      taken_down: false,
      created_at: new Date(baseMs - i * 3600_000).toISOString(),
      stickers,
    });
  }
  return packs;
}

/**
 * 全量表情包（官方 + 商城演示 + 本人发布）。发布/删除直接改这份状态。
 *
 * @remarks MSW browser 模式下状态随页面重载复位，E2E 各用例天然隔离。
 */
let mockPacks: MockPack[] = [
  {
    id: "pack_official_1",
    name: "元聊小黄脸",
    cover_url: null,
    owner_name: null,
    is_official: true,
    is_public: true,
    published_by_me: false,
    flagged: false,
    taken_down: false,
    created_at: "2026-01-01T00:00:00Z",
    stickers: MOCK_PACK_STICKERS,
  },
  ...seedMarketPacks(),
];

/** 当前 mock 用户已添加的包 id（「已添加」角标与 GET /sticker-packs 的可见集） */
const mockAddedPackIds = new Set<string>();

/** 测试辅助：剥掉 mock 内部字段，投影成商城列表项（added 相对 mock 用户）。 */
function toMarketPackDTO(p: MockPack) {
  return {
    id: p.id,
    name: p.name,
    cover_url: p.cover_url,
    owner_name: p.owner_name,
    is_official: p.is_official,
    sticker_count: p.stickers.length,
    created_at: p.created_at,
    added: mockAddedPackIds.has(p.id),
  };
}

/** 投影成「我发布的」列表项。 */
function toMyPackDTO(p: MockPack) {
  return {
    id: p.id,
    name: p.name,
    cover_url: p.cover_url,
    owner_name: p.owner_name,
    is_official: p.is_official,
    sticker_count: p.stickers.length,
    created_at: p.created_at,
    is_owner: true,
  };
}

/** 投影成包详情响应（pack 元信息 + 全部贴纸 + added）。 */
function toPackDetailDTO(p: MockPack) {
  return {
    pack: {
      id: p.id,
      name: p.name,
      cover_url: p.cover_url,
      is_official: p.is_official,
      owner_name: p.owner_name,
      is_owner: p.published_by_me,
      flagged: p.flagged,
      sticker_count: p.stickers.length,
      created_at: p.created_at,
    },
    stickers: p.stickers.map(toStickerDTO),
    added: mockAddedPackIds.has(p.id),
  };
}

/** 按 created_at 倒序排的商城可见集（is_public || is_official，下架的排除）。 */
function visiblePacksByNewest(): MockPack[] {
  return mockPacks
    .filter((p) => !p.taken_down && (p.is_public || p.is_official))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * 发布/追加贴纸的来源体校验：collection 校验收藏存在，upload 校验
 * images/ 锚定正则与 64 位十六进制 hash（与服务端同口径）。
 * 校验失败返回错误响应，成功返回要新建的贴纸行。
 */
// ========================================
// 媒体相册 Mock（由 DEMO_MESSAGES 过滤映射，与消息流同源）
// ========================================

/** 相册 type 参数 → 允许的消息 kind（与后端 message_type 白名单一致） */
const MEDIA_KINDS_BY_TYPE: Record<string, ChatMessageKind[]> = {
  all: ["image", "file", "voice", "video", "sticker"],
  image: ["image"],
  file: ["file"],
  voice: ["voice"],
  video: ["video"],
  sticker: ["sticker"],
};

/** 消息 kind → 后端 message_type */
const MEDIA_TYPE_BY_KIND: Record<string, 2 | 3 | 4 | 5 | 8> = {
  image: 2,
  file: 3,
  voice: 4,
  video: 5,
  sticker: 8,
};

/**
 * demo 文件/视频消息的字节数。
 *
 * @remarks 相册 DTO 的 `size` 是**字节数**，而 demo 数据里的 `file.size` / `video.size`
 *   是 "3.2 MB" 这类展示文案——直接 parseFloat 会把 3.2 当字节发出去（前端再格式化成 "3 B"）。
 *   故此处给出与展示文案自洽的真实字节数。
 */
const DEMO_MEDIA_BYTES: Record<string, number> = { file: 3355443, video: 2048000 };

/**
 * 通话房间快照（`GET /calls/:call_id`）。
 *
 * 字段与 `server/internal/handler/call.go` 的 `callRoomDTO` 对齐：给的是
 * `caller_id` 而非主叫完整资料。`conn_id` 在 `state=invited` 时为空串 ——
 * 前端 mesh 只对 `state=joined` 的成员建连，这个空串是分支覆盖的关键样本。
 */
const MOCK_CALL_ROOM = {
  call_id: "6f1c9c62-7f9a-4d7e-8f2b-1b0b1f2e3a41",
  conversation_id: "0a4c2f10-6f3d-4a58-9f77-2b0c9d1e4f52",
  media: "video",
  state: "ringing",
  caller_id: MOCK_USER.id,
  participants: [
    {
      user_id: MOCK_USER.id,
      conn_id: "b1e2c3d4-0000-4000-8000-000000000001",
      nickname: MOCK_USER.nickname,
      avatar_url: null,
      state: "joined",
    },
    {
      user_id: "5d0e2b8f-1c3a-4d92-8b7e-6f1a2c3d4e50",
      conn_id: "",
      nickname: "Bob",
      avatar_url: null,
      state: "invited",
    },
  ],
};

/** 相册条目 DTO（与 api/chat.ts 的 MediaItemDTO 同构，omitempty 语义靠 undefined 表达） */
interface MockMediaItem {
  message_id: string;
  seq: number;
  message_type: 2 | 3 | 4 | 5 | 8;
  sender_nickname: string;
  created_at: string;
  key?: string;
  thumb_key?: string;
  name?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  sticker_id?: string;
}

/** demo 消息 → 相册条目；按类型只填该类型有的字段（无 key 的样本由调用方过滤掉） */
function toMockMediaItem(m: ChatMessage): MockMediaItem {
  const base = {
    message_id: m.id,
    seq: m.seq ?? 0,
    message_type: MEDIA_TYPE_BY_KIND[m.kind],
    sender_nickname: m.senderName ?? MOCK_USER.nickname,
    created_at: new Date(m.createdAtMs ?? Date.now()).toISOString(),
  };
  if (m.kind === "image") {
    return { ...base, key: m.image?.key, width: m.image?.width, height: m.image?.height };
  }
  if (m.kind === "file") {
    return { ...base, key: m.file?.key, name: m.file?.name, size: DEMO_MEDIA_BYTES.file };
  }
  if (m.kind === "voice") {
    return { ...base, key: m.voice?.key, duration: m.voice?.seconds };
  }
  if (m.kind === "video") {
    return {
      ...base,
      key: m.video?.key,
      thumb_key: m.video?.thumbKey,
      name: m.video?.name,
      size: DEMO_MEDIA_BYTES.video,
      duration: m.video?.duration,
      width: m.video?.width,
      height: m.video?.height,
    };
  }
  return {
    ...base,
    key: m.sticker?.key,
    sticker_id: m.sticker?.stickerId,
    width: m.sticker?.width,
    height: m.sticker?.height,
  };
}

function resolveSource(src: {
  source?: string;
  sticker_id?: string;
  object_key?: string;
  width?: number;
  height?: number;
  content_hash?: string;
}): { ok: true; sticker: MockSticker } | { ok: false; response: ReturnType<typeof apiError> } {
  if (src.source === "collection") {
    const fav = mockMyStickers.find((s) => s.id === src.sticker_id);
    if (!fav) return { ok: false, response: apiError(40401, "sticker not found") };
    return {
      ok: true,
      sticker: {
        id: "pk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        object_key: fav.object_key,
        width: fav.width,
        height: fav.height,
      },
    };
  }
  if (src.source === "upload") {
    const KEY_RE = /^images\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]+\.[a-z0-9]+$/;
    if (!src.object_key || !KEY_RE.test(src.object_key)) {
      return { ok: false, response: apiError(40011, "invalid object key") };
    }
    if (!src.content_hash || !/^[0-9a-f]{64}$/.test(src.content_hash)) {
      return { ok: false, response: apiError(40012, "invalid content hash") };
    }
    if (!src.width || !src.height || src.width <= 0 || src.height <= 0) {
      return { ok: false, response: apiError(40013, "invalid size") };
    }
    return {
      ok: true,
      sticker: {
        id: "pk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        object_key: src.object_key,
        width: src.width,
        height: src.height,
      },
    };
  }
  return { ok: false, response: apiError(400, "invalid sticker source") };
}

// ========================================
// 处理器
// ========================================

export const handlers = [
  // --------------------------------------------------
  // 认证 — 登录
  // POST /api/v1/auth/login
  // 请求体：{ account: string; password: string }
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/login", async ({ request }) => {
    await delay(600); // 模拟网络延迟
    const body = (await request.json()) as { account?: string; password?: string };

    // 参数校验
    if (!body.account || body.account.trim().length < 3) {
      return apiError(40001, "账号长度至少 3 位");
    }
    if (!body.password || body.password.length < 6) {
      return apiError(40002, "密码长度至少 6 位");
    }

    // 演示：错误的密码
    // "wrong" — 短密码，走客户端校验
    // "Wrong@1234" — 满足客户端校验但服务端返回认证失败
    if (body.password === "wrong" || body.password === "Wrong@1234") {
      return apiError(40101, "账号或密码错误");
    }

    return apiOk({
      user: {
        ...MOCK_USER,
        nickname: body.account, // 用账号作为昵称
      },
      access_token: "mock_access_token_" + Date.now(),
      refresh_token: "mock_refresh_token_" + Date.now(),
      expires_in: 900, // 15 分钟
    });
  }),

  // --------------------------------------------------
  // 认证 — 注册
  // POST /api/v1/auth/register
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/register", async ({ request }) => {
    await delay(800);
    const body = (await request.json()) as {
      phone?: string;
      password?: string;
      captcha_id?: string;
      captcha_answer?: number;
      nickname?: string;
    };

    if (!body.phone || !body.password || !body.nickname) {
      return apiError(40003, "手机号、密码、昵称不能为空");
    }
    if (!body.captcha_answer) {
      return apiError(40004, "验证码不能为空");
    }

    return apiOk({
      user: {
        ...MOCK_USER,
        id: "user_" + Date.now(),
        phone: body.phone,
        nickname: body.nickname,
      },
      access_token: "mock_access_token_" + Date.now(),
      refresh_token: "mock_refresh_token_" + Date.now(),
      expires_in: 900,
    });
  }),

  // --------------------------------------------------
  // 认证 — 登出
  // POST /api/v1/auth/logout
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/logout", async () => {
    await delay(300);
    return apiOk({ message: "logged out" });
  }),

  // --------------------------------------------------
  // 验证码 — 获取
  // GET /api/v1/captcha
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/captcha", async () => {
    await delay(300);

    const svg = generateCaptchaSvg();

    return new HttpResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "X-Captcha-ID": "mock_captcha_" + Date.now(),
      },
    });
  }),

  // --------------------------------------------------
  // 会话 — 清空聊天记录（单侧软清空）
  // DELETE /api/v1/conversations/:id/messages
  // --------------------------------------------------
  http.delete("http://localhost:8085/api/v1/conversations/:id/messages", async () => {
    await delay(200);
    return apiOk({});
  }),

  // --------------------------------------------------
  // 会话 — 媒体相册（按类型聚合，seq 降序）
  // GET /api/v1/conversations/:id/media?type=&before_seq=&limit=
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/conversations/:id/media", async ({ params, request }) => {
    // 300ms 延迟：让骨架屏（加载态）在演示与 E2E 里真的能看见
    await delay(300);
    const url = new URL(request.url);
    // ?error=1 仅 mock 支持，供错误态+重试联调（真实后端会忽略该参数）
    if (url.searchParams.get("error") === "1") {
      return apiError(500, "media load failed");
    }
    const type = url.searchParams.get("type") ?? "all";
    const kinds = MEDIA_KINDS_BY_TYPE[type];
    // 非白名单 type 与后端同口径回 400，避免前端在 mock 下写出真实后端会拒的调用
    if (!kinds) return apiError(400, "invalid media type");

    const beforeSeq = Number(url.searchParams.get("before_seq") ?? "0") || 0;
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? "30") || 30);
    const source = DEMO_MESSAGES[String(params.id)] ?? [];
    const all = source
      .filter((m) => kinds.indexOf(m.kind) >= 0)
      .map(toMockMediaItem)
      // 无对象 key 的样本（历史遗留 demo 条目）不构成媒体，签不出下载 URL
      .filter((i) => !!i.key)
      .filter((i) => beforeSeq <= 0 || i.seq < beforeSeq)
      .sort((a, b) => b.seq - a.seq);
    const page = all.slice(0, limit);
    // has_more 与后端同口径：满页即视为「可能还有更早的」（见 handler/message.go 的 Media）
    return apiOk({ items: page, has_more: page.length === limit });
  }),

  // --------------------------------------------------
  // 会话 — 更新群公告（管理员，空串清除）
  // PATCH /api/v1/conversations/:id/announcement
  // --------------------------------------------------
  http.patch("http://localhost:8085/api/v1/conversations/:id/announcement", async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { announcement?: string | null };
    return apiOk({ announcement: body.announcement ?? null });
  }),

  // --------------------------------------------------
  // 会话 — 设置本人群昵称（空串清除）
  // PUT /api/v1/conversations/:id/my-alias
  // --------------------------------------------------
  http.put("http://localhost:8085/api/v1/conversations/:id/my-alias", async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { alias?: string };
    return apiOk({ alias: body.alias ?? "" });
  }),

  // --------------------------------------------------
  // 用户 — 公开资料（点消息头像弹出的资料卡按 id 现拉）
  // GET /api/v1/users/:id
  // 好友表里找不到时也返回一份占位资料：群里的陌生人同样要能看
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/users/:id", async ({ params }) => {
    await delay(150);
    const id = String(params.id);
    const friend = DEMO_FRIENDS.find((f) => f.id === id);
    return apiOk({
      id,
      nickname: friend?.nickname ?? MOCK_USER.nickname,
      avatar_url: friend?.avatarUrl ?? null,
      short_id: friend?.shortId ?? MOCK_USER.short_id,
      bio: "这是 mock 模式下的个性签名",
      gender: 0,
    });
  }),

  // --------------------------------------------------
  // 消息 — 编辑正文（四态：正常 / 窗口过期 / 次数超限 / 延迟）
  // PATCH /api/v1/messages/:id
  // --------------------------------------------------
  http.patch("http://localhost:8085/api/v1/messages/:id", async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    // ?error= 仅 mock 支持，供错误态联调（真实后端忽略该参数）
    const err = url.searchParams.get("error");
    if (err === "window") return apiError(4032, "edit window expired");
    if (err === "limit") return apiError(4033, "edit limit exceeded");
    const body = (await request.json()) as { text?: string };
    if (!body.text || body.text.trim() === "") return apiError(4004, "message not editable");
    return apiOk({ edited_at: new Date().toISOString(), edit_count: 1 });
  }),

  // --------------------------------------------------
  // 消息 — 编辑历史（四态：正常 / 空 / 错误 / 延迟）
  // GET /api/v1/messages/:id/edits
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/messages/:id/edits", async ({ request }) => {
    // 300ms 延迟：让骨架屏在演示与 E2E 里真的能看见
    await delay(300);
    const url = new URL(request.url);
    if (url.searchParams.get("error") === "1") return apiError(500, "load edit history failed");
    if (url.searchParams.get("empty") === "1") return apiOk({ versions: [] });
    return apiOk({
      versions: [
        { version: 1, text: "最初发出的版本", edited_at: "2026-09-05T09:58:00Z" },
        { version: 2, text: "第一次修改", edited_at: "2026-09-05T09:59:00Z" },
        { version: 3, text: "当前版本", edited_at: "2026-09-05T10:00:00Z", current: true },
      ],
    });
  }),

  // --------------------------------------------------
  // 消息 — 撤回（此前缺失 mock，随编辑功能一并补上）
  // POST /api/v1/messages/:id/recall
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/messages/:id/recall", async ({ request }) => {
    await delay(150);
    if (new URL(request.url).searchParams.get("error") === "expired") {
      return apiError(4031, "recall window expired");
    }
    return apiOk({ message: "recalled" });
  }),

  // --------------------------------------------------
  // 通话 — ICE 服务器凭据
  // GET /api/v1/calls/ice-servers（?empty=1 无中继 / ?error=1 签发失败）
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/calls/ice-servers", async ({ request }) => {
    // 150ms 延迟：通话界面「连接中…」这一态在演示里要真的出现
    await delay(150);
    const url = new URL(request.url);
    if (url.searchParams.get("error") === "1") return apiError(500, "sign turn credential failed");
    // 空态 = TURN 未部署（turn.enabled=false）：只给 STUN，同网段仍可通
    if (url.searchParams.get("empty") === "1") {
      return apiOk({ ice_servers: [{ urls: ["stun:localhost:3478"] }], ttl: 3600 });
    }
    return apiOk({
      ice_servers: [
        { urls: ["stun:localhost:3478"] },
        {
          urls: ["turn:localhost:3478?transport=udp", "turn:localhost:3478?transport=tcp"],
          username: "1757142000:" + MOCK_USER.id,
          credential: "bW9jay1obWFjLXNoYTEtY3JlZGVudGlhbA==",
        },
      ],
      ttl: 3600,
    });
  }),

  // --------------------------------------------------
  // 通话 — 房间快照（桌面通话窗口启动时拉）
  // GET /api/v1/calls/:callId（callId=missing 已终结 / ?error=1 服务端故障）
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/calls/:callId", async ({ params, request }) => {
    await delay(150);
    if (new URL(request.url).searchParams.get("error") === "1") {
      return apiError(500, "load call room failed");
    }
    // 房间已终结：通话窗口须据此自行关闭，而不是停在空界面
    if (params.callId === "missing") return apiError(404, "call not found");
    return apiOk({ ...MOCK_CALL_ROOM, call_id: String(params.callId) });
  }),

  // --------------------------------------------------
  // 文件 — 换取下载 URL（mock 模式无 MinIO，直接给 data URL）
  // GET /api/v1/files/download-url?key=...
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/files/download-url", ({ request }) => {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key) return apiError(40010, "key required");
    return apiOk({ url: mockObjectDataUrl(key), expires_in: 3600 });
  }),

  // --------------------------------------------------
  // 贴纸 — 本人收藏列表
  // GET /api/v1/stickers/mine
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/stickers/mine", async () => {
    await delay(150);
    return apiOk({ stickers: mockMyStickers.map(toStickerDTO), has_more: false });
  }),

  // --------------------------------------------------
  // 贴纸 — 收藏一张（按 content_hash 幂等，与后端 ON CONFLICT 语义一致）
  // POST /api/v1/stickers
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/stickers", async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as {
      object_key?: string;
      width?: number;
      height?: number;
      content_hash?: string;
    };
    // 与服务端同口径的形态校验：key 锚定正则、hash 必须是 64 位小写十六进制、宽高为正
    // 与服务端 handler/file.go 的锚定正则同形（贴纸只收 images/ 前缀）
    const KEY_RE = /^images\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]+\.[a-z0-9]+$/;
    if (!body.object_key || !KEY_RE.test(body.object_key)) {
      return apiError(40011, "invalid object key");
    }
    if (!body.content_hash || !/^[0-9a-f]{64}$/.test(body.content_hash)) {
      return apiError(40012, "invalid content hash");
    }
    if (!body.width || !body.height || body.width <= 0 || body.height <= 0) {
      return apiError(40013, "invalid size");
    }
    const existing = mockMyStickers.find((s) => s.content_hash === body.content_hash);
    if (existing) return apiOk(toStickerDTO(existing));

    const created: MockSticker = {
      id: "fav_sticker_" + (mockMyStickers.length + 1) + "_" + Date.now(),
      object_key: body.object_key,
      width: body.width,
      height: body.height,
      content_hash: body.content_hash,
    };
    mockMyStickers = [created].concat(mockMyStickers);
    return apiOk(toStickerDTO(created));
  }),

  // --------------------------------------------------
  // 贴纸 — 取消收藏（不存在回 404，与服务端 RowsAffected==0 的口径一致）
  // DELETE /api/v1/stickers/:id
  // --------------------------------------------------
  http.delete("http://localhost:8085/api/v1/stickers/:id", async ({ params }) => {
    await delay(150);
    const id = String(params.id);
    if (!mockMyStickers.some((s) => s.id === id)) return apiError(40401, "sticker not found");
    mockMyStickers = mockMyStickers.filter((s) => s.id !== id);
    return apiOk({ message: "removed" });
  }),

  // --------------------------------------------------
  // 贴纸 — 我的表情包列表（官方包 + 已添加的包，与服务端扩展后的语义一致）
  // GET /api/v1/sticker-packs
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/sticker-packs", async ({ request }) => {
    await delay(150);
    const qs = new URL(request.url).searchParams;
    const limit = Number(qs.get("limit") ?? 0) || 0;
    const cursor = qs.get("cursor");
    const visible = mockPacks.filter((p) => p.is_official || mockAddedPackIds.has(p.id));
    const toDTO = (p: (typeof visible)[number]) => ({
      pack: { id: p.id, name: p.name, cover_url: p.cover_url, is_official: p.is_official, sort: 0 },
      stickers: p.stickers.map(toStickerDTO),
    });
    // 分页可选：不传 limit 返回全量（向后兼容）；传 limit 按 created_at 升序
    // 游标分页，next_cursor 为最后一条的 created_at（与服务端 ListPacks 契约一致）
    if (limit > 0) {
      const ordered = visible
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      const filtered = cursor ? ordered.filter((p) => p.created_at > cursor) : ordered;
      const page = filtered.slice(0, limit);
      const nextCursor =
        filtered.length > page.length && page.length > 0 ? page[page.length - 1].created_at : null;
      return apiOk({ packs: page.map(toDTO), next_cursor: nextCursor });
    }
    return apiOk({ packs: visible.map(toDTO), next_cursor: null });
  }),

  // --------------------------------------------------
  // 收藏 — 列表（倒序 + created_at 游标 + 类型过滤，与服务端 List 同口径）
  // GET /api/v1/favorites
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/favorites", async ({ request }) => {
    await delay(150);
    const qs = new URL(request.url).searchParams;
    const type = Number(qs.get("type") ?? 0);
    const limit = Number(qs.get("limit") ?? 20) || 20;
    const before = qs.get("before");
    let list = mockFavorites.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (type > 0) list = list.filter((f) => f.message_type === type);
    // 游标是上一页最后一条的 created_at，严格早于它的才算下一页
    if (before) list = list.filter((f) => f.created_at < before);
    const page = list.slice(0, limit);
    return apiOk({ favorites: page, has_more: list.length > page.length });
  }),

  // --------------------------------------------------
  // 收藏 — 添加（按 message_id 幂等，与服务端唯一索引语义一致）
  // POST /api/v1/favorites
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/favorites", async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { message_id?: string };
    if (!body.message_id) return apiError(40014, "message_id required");
    const existing = mockFavorites.find((f) => f.message_id === body.message_id);
    if (existing) return apiOk({ id: existing.id, message_id: existing.message_id });

    // 真实后端按被收藏消息落快照；mock 拿不到那条消息，统一记成文字快照
    const created: MockFavorite = {
      id: "fav_" + (mockFavorites.length + 1) + "_" + Date.now(),
      message_id: body.message_id,
      conversation_id: "1",
      conv_name: "产品研发群",
      sender_nickname: "李四",
      message_type: 1,
      content: JSON.stringify({ text: "刚刚收藏的消息" }),
      created_at: new Date().toISOString(),
    };
    mockFavorites = [created].concat(mockFavorites);
    return apiOk({ id: created.id, message_id: created.message_id });
  }),

  // --------------------------------------------------
  // 收藏 — 取消（按 message_id；不存在也回成功，与服务端不校验 RowsAffected 一致）
  // DELETE /api/v1/favorites/:messageId
  // --------------------------------------------------
  http.delete("http://localhost:8085/api/v1/favorites/:messageId", async ({ params }) => {
    await delay(150);
    const messageId = String(params.messageId);
    mockFavorites = mockFavorites.filter((f) => f.message_id !== messageId);
    return apiOk({ message: "removed" });
  }),

  // ==================================================
  // A8 认证补全链路
  // ==================================================

  // --------------------------------------------------
  // 改密第 1 步 — 下发验证码
  // POST /api/v1/auth/password/otp
  // 未注册手机号与已注册的响应完全一致（同 204、同空体），避免暴露注册状态
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/password/otp", async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as { phone?: string };
    if (!body.phone) {
      return apiError(400, "auth.otpRequired");
    }
    if (body.phone === MOCK_COOLDOWN_PHONE) {
      return HttpResponse.json({ code: 429, message: "auth.sendFailed" }, { status: 429 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --------------------------------------------------
  // 改密第 2 步 — 校验验证码换一次性票据
  // POST /api/v1/auth/password/verify
  // 码错不消耗验证码，用户可原地重输
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/password/verify", async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as { phone?: string; code?: string };
    if (!body.phone || !body.code) {
      return apiError(400, "auth.otpRequired");
    }
    if (body.code !== MOCK_OTP_CODE) {
      return apiError(400, "auth.otpWrong");
    }
    return apiOk({ reset_ticket: MOCK_RESET_TICKET, expires_in: 300 });
  }),

  // --------------------------------------------------
  // 改密第 3 步 — 用票据设置新密码
  // POST /api/v1/auth/password/reset
  // 票据单次消费；弱密码被拒时票据不消耗
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/password/reset", async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as { reset_ticket?: string; new_password?: string };
    if (!body.reset_ticket || !body.new_password) {
      return apiError(400, "auth.resetFailed");
    }
    if (body.reset_ticket !== MOCK_RESET_TICKET || mockResetTicketUsed) {
      return apiError(400, "auth.resetFailed");
    }
    if (!/[a-z]/.test(body.new_password)) {
      return apiError(400, "validation.passwordLowercase");
    }
    mockResetTicketUsed = true;
    return new HttpResponse(null, { status: 204 });
  }),

  // --------------------------------------------------
  // 扫码登录 — 建会话（被扫端，公开）
  // POST /api/v1/auth/qr/session
  // poll_secret 只在此处下发，绝不进 qr_payload
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/qr/session", async () => {
    await delay(200);
    mockQrPollCount = 0;
    mockQrTokensClaimed = false;
    mockQrCanceled = false;
    return apiOk({
      qr_token: MOCK_QR_TOKEN,
      qr_payload: "yuanchat://login?t=" + MOCK_QR_TOKEN,
      expires_in: MOCK_QR_TTL_SECONDS,
      poll_secret: MOCK_QR_POLL_SECRET,
    });
  }),

  // --------------------------------------------------
  // 扫码登录 — 轮询（被扫端，公开但必须带 X-Qr-Poll-Secret）
  // GET /api/v1/auth/qr/:token
  // 前两次 pending/scanned，第三次 confirmed 并交出令牌；令牌只能取走一次
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/auth/qr/:token", async ({ params, request }) => {
    await delay(120);
    if (request.headers.get("X-Qr-Poll-Secret") !== MOCK_QR_POLL_SECRET) {
      return HttpResponse.json({ code: 403, message: "auth.qrFailed" }, { status: 403 });
    }
    if (String(params.token) !== MOCK_QR_TOKEN || mockQrTokensClaimed) {
      return HttpResponse.json({ code: 404, message: "auth.qrExpired" }, { status: 404 });
    }

    mockQrPollCount += 1;
    const remaining = Math.max(0, MOCK_QR_TTL_SECONDS - mockQrPollCount * 2);
    // 取消是终态且会话不销毁：被扫端只有轮询到它才能区分「手机上按了取消」与「已过期」
    if (mockQrCanceled) {
      return apiOk({ status: "canceled", expires_in: remaining });
    }
    if (mockQrPollCount === 1) {
      return apiOk({ status: "pending", expires_in: remaining });
    }
    if (mockQrPollCount === 2) {
      return apiOk({ status: "scanned", expires_in: remaining });
    }

    mockQrTokensClaimed = true;
    return apiOk({
      status: "confirmed",
      expires_in: 0,
      tokens: {
        access_token: "mock-qr-access-token",
        refresh_token: "mock-qr-refresh-token",
        expires_in: 900,
      },
    });
  }),

  // --------------------------------------------------
  // 扫码登录 — 扫描（扫码端，需 Bearer 令牌）
  // POST /api/v1/auth/qr/:token/scan
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/qr/:token/scan", async ({ params }) => {
    await delay(150);
    if (String(params.token) !== MOCK_QR_TOKEN) {
      return HttpResponse.json({ code: 404, message: "auth.qrExpired" }, { status: 404 });
    }
    return apiOk({ nickname: MOCK_USER.nickname, avatar_url: MOCK_USER.avatar_url });
  }),

  // --------------------------------------------------
  // 扫码登录 — 确认（扫码端，需 Bearer 令牌）
  // POST /api/v1/auth/qr/:token/confirm
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/qr/:token/confirm", async ({ params }) => {
    await delay(150);
    if (String(params.token) !== MOCK_QR_TOKEN) {
      return HttpResponse.json({ code: 404, message: "auth.qrExpired" }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --------------------------------------------------
  // 扫码登录 — 取消（扫码端，需 Bearer 令牌）
  // POST /api/v1/auth/qr/:token/cancel
  // 会话进入 canceled 终态但不销毁，被扫端下一次轮询即看到该状态
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/qr/:token/cancel", async ({ params }) => {
    await delay(150);
    if (String(params.token) !== MOCK_QR_TOKEN) {
      return HttpResponse.json({ code: 404, message: "auth.qrExpired" }, { status: 404 });
    }
    mockQrCanceled = true;
    return new HttpResponse(null, { status: 204 });
  }),

  // --------------------------------------------------
  // 退出登录
  // POST /api/v1/auth/logout
  // 服务端不吊销令牌，客户端删本地令牌即为登出
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/auth/logout", async () => {
    await delay(100);
    return new HttpResponse(null, { status: 204 });
  }),

  // ==================================================
  // 表情商城与自主发布
  // 覆盖四态：正常（预置官方+24 个演示包）/ 空（我发布的初始为空）/
  // 错误（非法游标 400、发布体非法 400、达 20 个上限 400、越权 403、
  // 不存在 404）/ 加载（各 handler 统一 delay）
  // ==================================================

  // --------------------------------------------------
  // 文件 — 申请预签名上传 URL（按类别分流；公共读类别附 public_url）
  // POST /api/v1/files/upload-url?category=images|avatars|sticker-covers
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/files/upload-url", async ({ request }) => {
    await delay(150);
    const body = (await request.json()) as { filename?: string; content_type?: string };
    const category = new URL(request.url).searchParams.get("category") ?? "images";
    const ext =
      body.filename && body.filename.includes(".")
        ? body.filename.slice(body.filename.lastIndexOf("."))
        : ".png";
    const now = new Date();
    const objectKey =
      category +
      "/" +
      now.getUTCFullYear() +
      "/" +
      String(now.getUTCMonth() + 1).padStart(2, "0") +
      "/" +
      crypto.randomUUID() +
      ext;
    const data: {
      upload_url: string;
      object_key: string;
      public_url?: string;
      expires_in: number;
    } = {
      upload_url: "http://localhost:8085/mock-storage/" + objectKey,
      object_key: objectKey,
      expires_in: 3600,
    };
    // 公共读类别（头像/表情包封面）直接给可渲染的公共 URL；mock 里用 data URL，
    // 让 <img> 无需 MinIO 就能真的出图
    if (category === "avatars" || category === "sticker-covers") {
      data.public_url = stickerDataUrl(objectKey);
    }
    return apiOk(data);
  }),

  // --------------------------------------------------
  // 对象存储 — mock 直传端点（配合上面的 upload_url）
  // PUT /mock-storage/:key…
  // --------------------------------------------------
  http.put("http://localhost:8085/mock-storage/*", async () => {
    await delay(150);
    return new HttpResponse(null, { status: 200 });
  }),

  // --------------------------------------------------
  // 举报 — 提交（本批新增 target_type=sticker_pack）
  // POST /api/v1/reports
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/reports", async () => {
    await delay(200);
    return apiOk({ id: "report_" + Date.now(), status: 0 });
  }),

  // --------------------------------------------------
  // 商城 — 列表（created_at 倒序 + created_at 游标，与服务端 Market 同口径）
  // GET /api/v1/sticker-packs/market?cursor=&limit=
  // 注意：静态段 market/mine 须先于 :id 注册，避免被参数路由吃掉
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/sticker-packs/market", async ({ request }) => {
    await delay(200);
    const qs = new URL(request.url).searchParams;
    const limit = Math.min(50, Number(qs.get("limit")) || 20);
    const cursor = qs.get("cursor");
    if (cursor) {
      // 与服务端一致：游标必须是合法 RFC3339 时间戳
      if (Number.isNaN(Date.parse(cursor))) {
        return apiError(400, "invalid cursor");
      }
    }
    let list = visiblePacksByNewest();
    if (cursor) list = list.filter((p) => p.created_at < cursor);
    const page = list.slice(0, limit);
    const hasMore = list.length > page.length;
    return apiOk({
      packs: page.map(toMarketPackDTO),
      next_cursor: hasMore && page.length > 0 ? page[page.length - 1].created_at : null,
    });
  }),

  // --------------------------------------------------
  // 商城 — 我发布的（初始为空，发布后出现）
  // GET /api/v1/sticker-packs/mine
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/sticker-packs/mine", async () => {
    await delay(200);
    return apiOk({
      packs: mockPacks.filter((p) => p.published_by_me).map(toMyPackDTO),
    });
  }),

  // --------------------------------------------------
  // 商城 — 发布（一步创建即公开；达 20 个回 400 + 业务码 4003 publish limit exceeded）
  // POST /api/v1/sticker-packs
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/sticker-packs", async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as {
      name?: string;
      cover_object_key?: string;
      sticker_sources?: Array<Record<string, unknown>>;
    };
    const name = (body.name ?? "").trim();
    if (!name || name.length > 64) return apiError(400, "invalid pack name");
    if (!Array.isArray(body.sticker_sources) || body.sticker_sources.length === 0) {
      return apiError(400, "sticker sources must not be empty");
    }
    if (mockPacks.filter((p) => p.published_by_me).length >= 20) {
      // 与真实服务端同码：400 + 业务码 4003，前端按 code 识别上限错误
      return apiError(4003, "publish limit exceeded");
    }
    const stickers: MockSticker[] = [];
    for (const src of body.sticker_sources) {
      const resolved = resolveSource(src);
      if (!resolved.ok) return resolved.response;
      stickers.push(resolved.sticker);
    }
    const pack: MockPack = {
      id: "pack_" + crypto.randomUUID(),
      name,
      // 服务端把 cover_object_key 转成公共 URL；mock 里给可渲染的 data URL
      cover_url: body.cover_object_key ? stickerDataUrl(body.cover_object_key) : null,
      owner_name: MOCK_USER.nickname,
      is_official: false,
      is_public: true,
      published_by_me: true,
      flagged: false,
      taken_down: false,
      created_at: new Date().toISOString(),
      stickers,
    };
    mockPacks = [pack].concat(mockPacks);
    return apiOk(toPackDetailDTO(pack));
  }),

  // --------------------------------------------------
  // 商城 — 包详情（含全部贴纸与 is_owner；不存在/下架未添加回 404）
  // GET /api/v1/sticker-packs/:id
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/sticker-packs/:id", async ({ params }) => {
    await delay(200);
    const id = String(params.id);
    const pack = mockPacks.find((p) => p.id === id);
    if (!pack || (pack.taken_down && !mockAddedPackIds.has(id))) {
      return apiError(40404, "sticker pack not found");
    }
    return apiOk(toPackDetailDTO(pack));
  }),

  // --------------------------------------------------
  // 商城 — 添加到我的表情包（幂等；下架/未公开回 404）
  // POST /api/v1/sticker-packs/:id/add
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/sticker-packs/:id/add", async ({ params }) => {
    await delay(200);
    const id = String(params.id);
    const pack = mockPacks.find((p) => p.id === id);
    if (!pack || pack.taken_down || !(pack.is_public || pack.is_official)) {
      return apiError(40404, "sticker pack not available");
    }
    mockAddedPackIds.add(id);
    return apiOk({ message: "added" });
  }),

  // --------------------------------------------------
  // 商城 — 从我的表情包移除（幂等，不影响包本身）
  // DELETE /api/v1/sticker-packs/:id/add
  // --------------------------------------------------
  http.delete("http://localhost:8085/api/v1/sticker-packs/:id/add", async ({ params }) => {
    await delay(200);
    mockAddedPackIds.delete(String(params.id));
    return apiOk({ message: "removed" });
  }),

  // --------------------------------------------------
  // 商城 — 编辑本人发布的包（改名/换封面；非本人 403）
  // PATCH /api/v1/sticker-packs/:id
  // --------------------------------------------------
  http.patch("http://localhost:8085/api/v1/sticker-packs/:id", async ({ params, request }) => {
    await delay(250);
    const id = String(params.id);
    const pack = mockPacks.find((p) => p.id === id);
    if (!pack) return apiError(40404, "sticker pack not found");
    if (!pack.published_by_me) return apiError(403, "not the pack owner");
    const body = (await request.json()) as {
      name?: string;
      cover_object_key?: string;
    };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name || name.length > 64) return apiError(400, "invalid pack name");
      pack.name = name;
    }
    if (body.cover_object_key) pack.cover_url = stickerDataUrl(body.cover_object_key);
    return apiOk(toPackDetailDTO(pack));
  }),

  // --------------------------------------------------
  // 商城 — 给本人发布的包追加贴纸（collection/upload 两来源）
  // POST /api/v1/sticker-packs/:id/stickers
  // --------------------------------------------------
  http.post(
    "http://localhost:8085/api/v1/sticker-packs/:id/stickers",
    async ({ params, request }) => {
      await delay(250);
      const id = String(params.id);
      const pack = mockPacks.find((p) => p.id === id);
      if (!pack) return apiError(40404, "sticker pack not found");
      if (!pack.published_by_me) return apiError(403, "not the pack owner");
      const body = (await request.json()) as Record<string, unknown>;
      const resolved = resolveSource(body);
      if (!resolved.ok) return resolved.response;
      pack.stickers = [resolved.sticker].concat(pack.stickers);
      return apiOk({ message: "added" });
    },
  ),

  // --------------------------------------------------
  // 商城 — 从本人发布的包移除贴纸（不动原收藏）
  // DELETE /api/v1/sticker-packs/:id/stickers/:stickerId
  // --------------------------------------------------
  http.delete(
    "http://localhost:8085/api/v1/sticker-packs/:id/stickers/:stickerId",
    async ({ params }) => {
      await delay(200);
      const id = String(params.id);
      const pack = mockPacks.find((p) => p.id === id);
      if (!pack) return apiError(40404, "sticker pack not found");
      if (!pack.published_by_me) return apiError(403, "not the pack owner");
      pack.stickers = pack.stickers.filter((s) => s.id !== String(params.stickerId));
      return apiOk({ message: "removed" });
    },
  ),

  // --------------------------------------------------
  // 商城 — 删除本人发布的包（级联清除添加关系；非本人 403）
  // DELETE /api/v1/sticker-packs/:id
  // --------------------------------------------------
  http.delete("http://localhost:8085/api/v1/sticker-packs/:id", async ({ params }) => {
    await delay(250);
    const id = String(params.id);
    const pack = mockPacks.find((p) => p.id === id);
    if (!pack) return apiError(40404, "sticker pack not found");
    if (!pack.published_by_me) return apiError(403, "not the pack owner");
    mockPacks = mockPacks.filter((p) => p.id !== id);
    mockAddedPackIds.delete(id);
    return apiOk({ message: "deleted" });
  }),

  // --------------------------------------------------
  // 兜底：其他未匹配的 localhost 请求放行
  // --------------------------------------------------
  http.all("http://localhost:8085/*", () => {
    return passthrough();
  }),
];
