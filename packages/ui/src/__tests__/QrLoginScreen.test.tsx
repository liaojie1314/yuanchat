/**
 * QrLoginScreen 行为测试（扫码登录接真后端）
 *
 * 测试范围：建会话与二维码内容、轮询节奏与轮询密钥请求头、三个状态的落地、
 * 倒计时取服务端字段、confirmed 后写入登录态、各错误分支停轮询与文案落点。
 * 依赖：fetch 替身（不打真后端）、MemoryRouter（组件内有 <Link to="/login">）、authStore。
 *
 * jsdom 默认 locale 为 en-US，setup.ts 已初始化 i18n，
 * 因此所有 t() 文案断言使用英文值（与 ForgotPasswordScreen.test 风格一致）。
 *
 * 全文启用假定时器：轮询是 setInterval、倒计时是链式 setTimeout，
 * 用 tick() 逐秒推进；假定时器下不能用 waitFor（它依赖真实定时器会直接超时），
 * 改为 flush() 冲干 promise 链后同步断言。
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@yuanchat/shared";
import { QrLoginScreen } from "../auth/QrLoginScreen";

const SESSION = "/api/v1/auth/qr/session";
const ME = "/api/v1/users/me";
/** 轮询路径按会话凭据拼出；替身按前缀匹配 */
const POLL_PREFIX = "/api/v1/auth/qr/";

const QR_TOKEN = "qr-token-fixture";
const POLL_SECRET = "poll-secret-fixture";
/** 刻意与 `yuanchat://login?t=<qr_token>` 不同：前端若自己拼 URL，断言就会红 */
const QR_PAYLOAD = "yuanchat://login?t=" + QR_TOKEN + "&src=server";

/** 一次登记的响应；204 走空体分支 */
interface Reply {
  status: number;
  body?: unknown;
}

/** 一次实际发出的请求 */
interface Call {
  path: string;
  body?: string;
  headers: Record<string, string>;
}

let routes: Map<string, Reply[]>;
let calls: Call[];
/** 开启后轮询响应挂住不兑现，由用例决定何时兑现，用来制造「两次轮询同时在飞」的时序 */
let holdPoll = false;
/** 挂住的轮询响应的兑现函数，按发出顺序排列 */
let held: Array<(r: Reply) => void>;

function reply(path: string, ...rs: Reply[]) {
  routes.set(path, rs);
}

/** 统一响应壳（成功） */
function ok(data: unknown): Reply {
  return { status: 200, body: { code: 0, message: "ok", data } };
}

/** 统一响应壳（出错），message 即后端的 i18n key 或裸文案 */
function fail(code: number, message: string): Reply {
  return { status: code, body: { code, message } };
}

function callsTo(prefix: string): Call[] {
  return calls.filter((c) => c.path.startsWith(prefix));
}

/** 轮询调用（排除建会话本身，它是同前缀的 POST /session） */
function pollCalls(): Call[] {
  return callsTo(POLL_PREFIX).filter((c) => c.path !== SESSION);
}

/** 建会话响应：默认 120 秒 */
function sessionReply(expiresIn = 120): Reply {
  return ok({
    qr_token: QR_TOKEN,
    qr_payload: QR_PAYLOAD,
    expires_in: expiresIn,
    poll_secret: POLL_SECRET,
  });
}

/** 把一条登记的响应变成 fetch 的返回值；204 与浏览器一致地让 res.json() 抛 SyntaxError */
function toResponse(r: Reply) {
  if (r.status === 204) {
    return {
      status: 204,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    };
  }
  return { status: r.status, json: () => Promise.resolve(r.body) };
}

/** 装 fetch 替身：按路径取队首响应（队列剩最后一个时重复使用） */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = String(url).replace("http://localhost:8085", "");
      calls.push({
        path,
        body: init?.body as string | undefined,
        headers: (init?.headers as Record<string, string>) || {},
      });
      if (holdPoll && path !== SESSION && path.startsWith(POLL_PREFIX)) {
        return new Promise((resolve) => {
          held.push((r: Reply) => resolve(toResponse(r)));
        });
      }
      const queue = routes.get(path);
      if (!queue || queue.length === 0) return Promise.reject(new Error("unexpected " + path));
      const r = queue.length > 1 ? (queue.shift() as Reply) : queue[0];
      return Promise.resolve(toResponse(r));
    }),
  );
}

function renderScreen(props: { onLoggedIn?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <QrLoginScreen {...props} />
    </MemoryRouter>,
  );
}

/** 冲干挂起的 promise 链与随之而来的 effect（不推进定时器） */
async function flush() {
  await act(async () => {});
}

/** 逐秒推进假定时器，每秒一次 act 让链式定时器的下一跳被重新排上 */
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

/** 读取渲染出的二维码承载的内容 */
function qrValue(): string {
  const node = screen.getByTestId("qr-code");
  return node.getAttribute("data-qr-value") || "";
}

describe("QrLoginScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    routes = new Map();
    calls = [];
    held = [];
    holdPoll = false;
    stubFetch();
    reply(SESSION, sessionReply());
    reply(POLL_PREFIX + QR_TOKEN, ok({ status: "pending", expires_in: 118 }));
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("挂载即建会话，请求体为空对象（后端要求 body 必须存在）", async () => {
    renderScreen();
    await flush();

    const created = calls.filter((c) => c.path === SESSION);
    expect(created).toHaveLength(1);
    expect(created[0].body).toBe("{}");
  });

  it("二维码内容原样取服务端 qr_payload，不在前端自己拼 URL", async () => {
    renderScreen();
    await flush();

    expect(qrValue()).toBe(QR_PAYLOAD);
    // 自拼的话会是这个串，绝不能相等
    expect(qrValue()).not.toBe("yuanchat://login?t=" + QR_TOKEN);
  });

  it("每 2 秒轮询一次，且必须带 X-Qr-Poll-Secret 请求头", async () => {
    renderScreen();
    await flush();
    expect(pollCalls()).toHaveLength(0);

    await tick(2);
    expect(pollCalls()).toHaveLength(1);
    expect(pollCalls()[0].path).toBe(POLL_PREFIX + QR_TOKEN);
    expect(pollCalls()[0].headers["X-Qr-Poll-Secret"]).toBe(POLL_SECRET);

    await tick(2);
    expect(pollCalls()).toHaveLength(2);
    // 2 秒一次：4 秒内不得多打（后端 LimitByIP(30,60) 就是按这个额度给的）
    expect(pollCalls().length).toBeLessThanOrEqual(2);
  });

  it("轮询到 scanned 时提示已扫描并请在手机上确认", async () => {
    reply(POLL_PREFIX + QR_TOKEN, ok({ status: "scanned", expires_in: 100 }));
    renderScreen();
    await flush();
    await tick(2);

    expect(screen.getByText("Scanned")).toBeInTheDocument();
    expect(screen.getByText("Confirm the sign-in on your phone")).toBeInTheDocument();
  });

  it("轮询到 confirmed 时写入登录态、拉取本人资料并回调，然后停止轮询", async () => {
    reply(
      POLL_PREFIX + QR_TOKEN,
      ok({
        status: "confirmed",
        expires_in: 0,
        tokens: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 },
      }),
    );
    reply(ME, ok({ id: "u-1", nickname: "扫码的人", short_id: 10001, gender: 1 }));
    const onLoggedIn = vi.fn();
    renderScreen({ onLoggedIn });
    await flush();
    await tick(2);
    await flush();

    const s = useAuthStore.getState();
    expect(s.accessToken).toBe("at-1");
    expect(s.refreshToken).toBe("rt-1");
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.nickname).toBe("扫码的人");
    expect(onLoggedIn).toHaveBeenCalledTimes(1);

    // 令牌只能取一次，拿到之后绝不能再打轮询端点
    const pollsWhenDone = pollCalls().length;
    await tick(6);
    expect(pollCalls()).toHaveLength(pollsWhenDone);
  });

  it("access 令牌寿命取 tokens.expires_in，不取会话剩余秒数", async () => {
    reply(
      POLL_PREFIX + QR_TOKEN,
      ok({
        status: "confirmed",
        expires_in: 0,
        tokens: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 },
      }),
    );
    reply(ME, ok({ id: "u-1", nickname: "me", short_id: 1, gender: 0 }));
    renderScreen();
    await flush();
    await tick(2);
    await flush();

    const expiresAt = useAuthStore.getState().expiresAt as number;
    // 用 tokens.expires_in（3600s）而不是 data.expires_in（0）算过期时刻
    expect(expiresAt - Date.now()).toBeGreaterThan(3000 * 1000);
  });

  it("倒计时取服务端 expires_in：喂 3 秒则 3 秒后进过期态", async () => {
    reply(SESSION, sessionReply(3));
    // 轮询回的剩余秒数同样很小；服务端值是权威，本地 tick 只负责逐秒递减
    reply(POLL_PREFIX + QR_TOKEN, ok({ status: "pending", expires_in: 1 }));
    renderScreen();
    await flush();
    expect(screen.queryByText("QR code expired")).not.toBeInTheDocument();

    await tick(3);
    expect(screen.getByText("QR code expired")).toBeInTheDocument();
    // 过期后不许继续打轮询
    const pollsWhenExpired = pollCalls().length;
    await tick(6);
    expect(pollCalls()).toHaveLength(pollsWhenExpired);
  });

  it("轮询到 404 即停止轮询并给出刷新入口，点刷新重新建会话", async () => {
    reply(POLL_PREFIX + QR_TOKEN, fail(404, "auth.qrExpired"));
    renderScreen();
    await flush();
    await tick(2);

    expect(screen.getByText("QR code expired")).toBeInTheDocument();
    const pollsWhenExpired = pollCalls().length;
    await tick(6);
    expect(pollCalls()).toHaveLength(pollsWhenExpired);

    // 刷新：重新建会话
    reply(SESSION, sessionReply(), sessionReply());
    reply(POLL_PREFIX + QR_TOKEN, ok({ status: "pending", expires_in: 120 }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh QR code/ }));
    await flush();
    expect(calls.filter((c) => c.path === SESSION)).toHaveLength(2);
    expect(screen.queryByText("QR code expired")).not.toBeInTheDocument();
  });

  it("轮询密钥不匹配的 403 停止轮询并显示扫码失败文案", async () => {
    reply(POLL_PREFIX + QR_TOKEN, fail(403, "auth.qrFailed"));
    renderScreen();
    await flush();
    await tick(2);

    expect(screen.getByText("QR sign-in failed, please refresh the code")).toBeInTheDocument();
    const polls = pollCalls().length;
    await tick(6);
    expect(pollCalls()).toHaveLength(polls);
  });

  it("状态机违例的 409 复用扫码失败文案，不新增第二句", async () => {
    reply(POLL_PREFIX + QR_TOKEN, fail(409, "auth.qrBadState"));
    renderScreen();
    await flush();
    await tick(2);

    expect(screen.getByText("QR sign-in failed, please refresh the code")).toBeInTheDocument();
  });

  it("IP 限流的 429 显示通用限流文案，绝不把后端裸英文上屏", async () => {
    reply(POLL_PREFIX + QR_TOKEN, fail(429, "rate limit exceeded, please try again later"));
    renderScreen();
    await flush();
    await tick(2);

    expect(screen.getByText("Too many requests, please try again later")).toBeInTheDocument();
    expect(
      screen.queryByText("rate limit exceeded, please try again later"),
    ).not.toBeInTheDocument();
  });

  it("建会话失败时给出刷新入口而不是空白页", async () => {
    reply(SESSION, fail(500, "auth.qrFailed"));
    renderScreen();
    await flush();

    expect(screen.getByText("QR sign-in failed, please refresh the code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh QR code/ })).toBeInTheDocument();
    expect(pollCalls()).toHaveLength(0);
  });

  it("卸载后不再轮询（泄漏的 interval 会在切页后继续打接口）", async () => {
    const { unmount } = renderScreen();
    await flush();
    await tick(2);
    expect(pollCalls()).toHaveLength(1);

    unmount();
    await tick(10);
    expect(pollCalls()).toHaveLength(1);
  });

  it("确认之后迟到的轮询失败响应不得把成功页面盖成过期", async () => {
    // 轮询是 setInterval：上一次没回来，下一次照样出发，因此两次同时在飞是常态。
    // 先回来的那次拿到令牌并销毁会话，后回来的那次必然是 404 —— 它绝不能覆盖成功状态。
    holdPoll = true;
    reply(ME, ok({ id: "u-1", nickname: "扫码的人", short_id: 1, gender: 0 }));
    renderScreen();
    await flush();

    await tick(2);
    await tick(2);
    expect(held).toHaveLength(2);

    await act(async () => {
      held[0](
        ok({
          status: "confirmed",
          expires_in: 0,
          tokens: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 },
        }),
      );
    });
    await flush();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    await act(async () => {
      held[1](fail(404, "auth.qrExpired"));
    });
    await flush();

    expect(screen.queryByText("QR code expired")).not.toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
