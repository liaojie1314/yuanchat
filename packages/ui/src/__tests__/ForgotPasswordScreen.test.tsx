/**
 * ForgotPasswordScreen 行为测试（三段式改密接真接口）
 *
 * 测试范围：三步链路各自打到真实端点、错误分支的文案落点、票据有效期、成功后清本地令牌。
 * 依赖：fetch 替身（不打真后端）、MemoryRouter（组件内有 <Link to="/login">）、authStore。
 *
 * jsdom 默认 locale 为 en-US，setup.ts 已初始化 i18n，
 * 因此所有 t() 文案断言使用英文值（与 SettingsScreen.test 风格一致）。
 *
 * 全文启用假定时器：重发冷却与票据倒计时都是链式 setTimeout，
 * 用 tick() 逐秒推进（一次性推进 60s 不会让 effect 有机会排上下一跳）。
 * 假定时器下不能用异步查询（waitFor 依赖真实定时器，会直接挂到超时），
 * 改为 flush() 冲干 promise 链后同步断言 —— fetch 替身返回的都是已 resolve 的 promise。
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@yuanchat/shared";
import { ForgotPasswordScreen } from "../auth/ForgotPasswordScreen";

const OTP = "/api/v1/auth/password/otp";
const VERIFY = "/api/v1/auth/password/verify";
const RESET = "/api/v1/auth/password/reset";

/** 一次登记的响应；204 走空体分支 */
interface Reply {
  status: number;
  body?: unknown;
}

/** path → 响应队列（队列剩最后一个时重复使用，便于「同一端点连打两次」的用例） */
let routes: Map<string, Reply[]>;
/** 实际打出的请求路径序列 */
let calls: string[];

function reply(path: string, ...rs: Reply[]) {
  routes.set(path, rs);
}

function countCalls(path: string): number {
  return calls.filter((p) => p === path).length;
}

/** 装 fetch 替身：按路径取队首响应，204 与浏览器一致地让 res.json() 抛 SyntaxError */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = String(url).replace("http://localhost:8085", "");
      calls.push(path);
      const queue = routes.get(path);
      if (!queue || queue.length === 0) return Promise.reject(new Error("unexpected " + path));
      const r = queue.length > 1 ? (queue.shift() as Reply) : queue[0];
      if (r.status === 204) {
        return Promise.resolve({
          status: 204,
          json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
        });
      }
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
    }),
  );
}

/** 后端错误信封 */
function envelope(code: number, message: string): Reply {
  return { status: code, body: { code, message } };
}

function renderScreen(props: { onDone?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <ForgotPasswordScreen {...props} />
    </MemoryRouter>,
  );
}

/** 冲干挂起的 promise 链与随之而来的 effect（不需要推进定时器） */
async function flush() {
  await act(async () => {});
}

/** 逐秒推进假定时器，每秒一次 act 让链式 setTimeout 的下一跳被重新排上 */
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

async function gotoStep2(phone = "13800138000") {
  fireEvent.change(screen.getByPlaceholderText("Phone"), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
  await flush();
  expect(screen.getByPlaceholderText("6-digit code")).toBeInTheDocument();
}

async function gotoStep3(code = "123456") {
  await gotoStep2();
  fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await flush();
  expect(screen.getByPlaceholderText("New password")).toBeInTheDocument();
}

async function submitNewPassword(pw = "Abcdef12") {
  fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: pw } });
  fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: pw } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
}

describe("ForgotPasswordScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    routes = new Map();
    calls = [];
    stubFetch();
    reply(OTP, { status: 204 });
    reply(VERIFY, {
      status: 200,
      body: { code: 0, message: "ok", data: { reset_ticket: "tk-1", expires_in: 300 } },
    });
    reply(RESET, { status: 204 });
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("第 1 步提交手机号真的打发码端点并进入第 2 步", async () => {
    renderScreen();
    await gotoStep2();
    expect(countCalls(OTP)).toBe(1);
    expect(screen.getByText("Code sent to 13800138000")).toBeInTheDocument();
  });

  it("未注册手机号与已注册的渲染结果完全一致，且不额外探测手机号是否存在", async () => {
    // 后端对两种手机号都回 204 空体，前端无从区分，也绝不能造出可区分的表现
    const { container: first } = renderScreen();
    await gotoStep2("13800138000");
    const registered = first.innerHTML.replaceAll("13800138000", "PHONE");
    expect(countCalls(OTP)).toBe(1);
    expect(calls).toEqual([OTP]);
    cleanup();

    calls = [];
    const { container: second } = renderScreen();
    await gotoStep2("13900139000");
    const unregistered = second.innerHTML.replaceAll("13900139000", "PHONE");

    expect(unregistered).toBe(registered);
    expect(calls).toEqual([OTP]);
  });

  it("验证码错误留在第 2 步原地重输，且不重新发码", async () => {
    reply(VERIFY, envelope(400, "auth.otpWrong"), {
      status: 200,
      body: { code: 0, message: "ok", data: { reset_ticket: "tk-1", expires_in: 300 } },
    });
    renderScreen();
    await gotoStep2();
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await flush();
    expect(screen.getByText("Incorrect code, please try again")).toBeInTheDocument();
    // 仍在第 2 步：验证码输入框还在，新密码输入框还没出现
    expect(screen.getByPlaceholderText("6-digit code")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New password")).toBeNull();
    // 后端没消耗验证码，前端不得偷偷重发
    expect(countCalls(OTP)).toBe(1);

    // 原地重输正确验证码即可继续
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await flush();
    expect(screen.getByPlaceholderText("New password")).toBeInTheDocument();
    expect(countCalls(OTP)).toBe(1);
    expect(countCalls(VERIFY)).toBe(2);
  });

  it("重发按钮冷却结束后真的再次打发码端点", async () => {
    renderScreen();
    await gotoStep2();
    // 冷却中按钮不可点
    expect(screen.getByRole("button", { name: /Resend/ })).toBeDisabled();
    await tick(60);

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await flush();
    expect(countCalls(OTP)).toBe(2);
  });

  it("第 3 步用第 2 步换回的票据改密，而不是验证码", async () => {
    renderScreen();
    await gotoStep3();
    await submitNewPassword("Abcdef12");
    await flush();
    expect(screen.getByText("Password reset")).toBeInTheDocument();

    const call = vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).endsWith(RESET));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as unknown;
    expect(body).toEqual({ reset_ticket: "tk-1", new_password: "Abcdef12" });
  });

  it("改密成功后清空本地令牌（旧令牌已被服务端吊销）", async () => {
    useAuthStore.setState({
      user: { id: "u1", nickname: "Alice" },
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: Date.now() + 600_000,
      isAuthenticated: true,
    });
    renderScreen();
    await gotoStep3();
    await submitNewPassword();
    await flush();
    expect(screen.getByText("Password reset")).toBeInTheDocument();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it("弱密码按后端命中的规则显示对应文案，而不是笼统的改密失败", async () => {
    reply(RESET, envelope(400, "validation.passwordUppercase"));
    renderScreen();
    await gotoStep3();
    await submitNewPassword("Abcdef12");

    await flush();
    expect(screen.getByText("Password must include an uppercase letter")).toBeInTheDocument();
    expect(screen.queryByText("Reset failed, please try again")).toBeNull();
  });

  it("429 且 message 为 auth.accountLocked 时显示锁定文案", async () => {
    reply(VERIFY, envelope(429, "auth.accountLocked"));
    renderScreen();
    await gotoStep2();
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await flush();
    expect(screen.getByText("Too many attempts, try again in 15 minutes")).toBeInTheDocument();
  });

  it("IP 限流的 429 显示通用限流文案，绝不把后端裸英文上屏", async () => {
    reply(OTP, envelope(429, "rate limit exceeded, please try again later"));
    renderScreen();
    fireEvent.change(screen.getByPlaceholderText("Phone"), { target: { value: "13800138000" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

    await flush();
    expect(screen.getByText("Too many requests, please try again later")).toBeInTheDocument();
    expect(screen.queryByText("rate limit exceeded, please try again later")).toBeNull();
  });

  it("第 3 步的票据剩余时间取后端 expires_in 而非写死值", async () => {
    reply(VERIFY, {
      status: 200,
      body: { code: 0, message: "ok", data: { reset_ticket: "tk-1", expires_in: 90 } },
    });
    renderScreen();
    await gotoStep3();
    expect(screen.getByText("Complete within 1:30")).toBeInTheDocument();
    await tick(1);
    expect(screen.getByText("Complete within 1:29")).toBeInTheDocument();
  });

  it("票据过期后退回第 1 步并提示重新获取验证码", async () => {
    reply(VERIFY, {
      status: 200,
      body: { code: 0, message: "ok", data: { reset_ticket: "tk-1", expires_in: 3 } },
    });
    renderScreen();
    await gotoStep3();
    await tick(3);

    await flush();
    expect(screen.getByText("Session expired, request a new code")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Phone")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New password")).toBeNull();
  });

  it("传了 onDone 时成功页用它导航，不渲染 <Link>", async () => {
    const onDone = vi.fn();
    renderScreen({ onDone });
    await gotoStep3();
    await submitNewPassword();
    await flush();
    expect(screen.getByText("Password reset")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in now" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("验证码位数不足时不发请求，只做本地提示", async () => {
    renderScreen();
    await gotoStep2();
    fireEvent.change(screen.getByPlaceholderText("6-digit code"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await flush();
    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument();
    expect(countCalls(VERIFY)).toBe(0);
  });
});
