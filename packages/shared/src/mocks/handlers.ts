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
  avatarUrl: string | null;
  phone: string;
  email: string;
}

const MOCK_USER: MockUser = {
  id: "user_001",
  nickname: "元聊用户",
  avatarUrl: null,
  phone: "13800138000",
  email: "user@yuanchat.com",
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
 * - 后端可用时（localhost:8080 可达）→ 放行（passthrough）
 * - 后端不可用 → Mock 接管
 *
 * 注意：MSW passthrough 在 Service Worker 层面实现，
 * 这里直接返回 mock 数据即可。如果需要切换真实后端，
 * 将 VITE_ENABLE_MOCK=false 或直接关闭 MSW。
 */

// ========================================
// Handlers
// ========================================

export const handlers = [
  // --------------------------------------------------
  // 认证 — 登录
  // POST /api/v1/users/login
  // Body: { yuanchat_id: string; password: string }
  // --------------------------------------------------
  http.post("http://localhost:8080/api/v1/users/login", async ({ request }) => {
    await delay(600); // 模拟网络延迟
    const body = (await request.json()) as { yuanchat_id?: string; password?: string };

    // 参数校验
    if (!body.yuanchat_id || body.yuanchat_id.trim().length < 3) {
      return apiError(40001, "元聊号长度至少 3 位");
    }
    if (!body.password || body.password.length < 6) {
      return apiError(40002, "密码长度至少 6 位");
    }

    // 演示：错误的密码
    // "wrong" — 短密码，走客户端校验
    // "Wrong@1234" — 满足客户端校验但服务端返回认证失败
    if (body.password === "wrong" || body.password === "Wrong@1234") {
      return apiError(40101, "元聊号或密码错误");
    }

    return apiOk({
      user: {
        ...MOCK_USER,
        nickname: body.yuanchat_id, // 用元聊号作为昵称
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
  http.post("http://localhost:8080/api/v1/users/register", async ({ request }) => {
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
  http.post("http://localhost:8080/api/v1/auth/logout", async () => {
    await delay(300);
    return apiOk({ message: "logged out" });
  }),

  // --------------------------------------------------
  // 验证码 — 获取
  // GET /api/v1/captcha
  // --------------------------------------------------
  http.get("http://localhost:8080/api/v1/captcha", async () => {
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
  // 兜底：其他未匹配的 localhost 请求放行
  // --------------------------------------------------
  http.all("http://localhost:8080/*", () => {
    return passthrough();
  }),
];
