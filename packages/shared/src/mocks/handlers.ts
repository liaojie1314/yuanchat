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
// Helper
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

/** 测试辅助：剥掉仅 mock 内部使用的 content_hash，保持响应形状与真实接口一致。 */
function toStickerDTO(s: MockSticker) {
  return { id: s.id, object_key: s.object_key, width: s.width, height: s.height };
}

// ========================================
// Handlers
// ========================================

export const handlers = [
  // --------------------------------------------------
  // 认证 — 登录
  // POST /api/v1/users/login
  // Body: { account: string; password: string }
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/users/login", async ({ request }) => {
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
  // POST /api/v1/users/register
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/users/register", async ({ request }) => {
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
  // 文件 — 换取下载 URL（mock 模式无 MinIO，直接给 data URL）
  // GET /api/v1/files/download-url?key=...
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/files/download-url", ({ request }) => {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key) return apiError(40010, "key required");
    return apiOk({ url: stickerDataUrl(key), expires_in: 3600 });
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
  // 贴纸 — 表情包列表（仅官方包）
  // GET /api/v1/sticker-packs
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/sticker-packs", async () => {
    await delay(150);
    return apiOk({
      packs: [
        {
          pack: {
            id: "pack_official_1",
            name: "元聊小黄脸",
            cover_url: null,
            is_official: true,
            sort: 0,
          },
          stickers: MOCK_PACK_STICKERS.map(toStickerDTO),
        },
      ],
    });
  }),

  // --------------------------------------------------
  // 兜底：其他未匹配的 localhost 请求放行
  // --------------------------------------------------
  http.all("http://localhost:8085/*", () => {
    return passthrough();
  }),
];
