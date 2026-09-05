/**
 * ScanQrEntry 行为测试（扫码端，需已登录）
 *
 * 测试范围：扫到本应用二维码后登记扫描并展示账号、确认与放弃两条收尾各自打哪个端点、
 * 安卓返回键在取景中与确认框开着时的两种语义、取消失败不打扰用户。
 * 依赖：fetch 替身（不打真后端）、注入式 scan（无需真机相机）。
 *
 * 关键断言是「放弃确认必须回报服务端」：只关掉弹层而不打 cancel，
 * 被扫端会一直停在「请在手机上确认」直到会话过期，还会误以为是二维码过期。
 *
 * jsdom 默认 locale 为 en-US，setup.ts 已钉死 i18n 语言，故文案断言用英文值。
 */
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { runBackInterceptors } from "@yuanchat/shared";
import { ScanQrEntry } from "../auth/ScanQrEntry";

const QR_TOKEN = "scan-token-fixture";
const SCAN = "/api/v1/auth/qr/" + QR_TOKEN + "/scan";
const CONFIRM = "/api/v1/auth/qr/" + QR_TOKEN + "/confirm";
const CANCEL = "/api/v1/auth/qr/" + QR_TOKEN + "/cancel";

/** 一次登记的响应；204 走空体分支 */
interface Reply {
  status: number;
  body?: unknown;
}

let routes: Map<string, Reply>;
let calls: string[];

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

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = String(url).replace("http://localhost:8085", "");
      calls.push(path);
      const r = routes.get(path);
      if (!r) return Promise.reject(new Error("unexpected " + path));
      return Promise.resolve(toResponse(r));
    }),
  );
}

/** 冲干挂起的 promise 链与随之而来的 effect */
async function flush() {
  await act(async () => {});
}

/** 渲染并等到确认框弹出（即已完成 scan 登记） */
async function renderUntilConfirm(onClose = vi.fn(), cancelScan?: () => void) {
  const scan = vi.fn(() => Promise.resolve("yuanchat://login?t=" + QR_TOKEN));
  render(<ScanQrEntry scan={scan} cancelScan={cancelScan} active onClose={onClose} />);
  await flush();
  // 标题与确认按钮文案相同，按 heading 角色取才唯一
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Confirm login" })).toBeInTheDocument(),
  );
  return { scan, onClose };
}

describe("ScanQrEntry", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    routes = new Map();
    calls = [];
    stubFetch();
    routes.set(SCAN, {
      status: 200,
      body: { code: 0, message: "ok", data: { nickname: "扫码的人", avatar_url: null } },
    });
    routes.set(CONFIRM, { status: 204 });
    routes.set(CANCEL, { status: 204 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("扫到本应用二维码后登记扫描，并在确认前展示将以哪个账号登录", async () => {
    await renderUntilConfirm();

    expect(calls).toEqual([SCAN]);
    expect(screen.getByText("Sign in on the other device as “扫码的人”")).toBeInTheDocument();
    // 登记扫描不签发令牌，因此此刻绝不能已经打过 confirm
    expect(calls).not.toContain(CONFIRM);
  });

  it("非本应用的二维码不提交给后端，只提示来源不对", async () => {
    const onClose = vi.fn();
    const scan = vi.fn(() => Promise.resolve("https://example.com/whatever"));
    render(<ScanQrEntry scan={scan} active onClose={onClose} />);
    await flush();

    expect(calls).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("This is not a YuanChat login QR code");
    expect(onClose).toHaveBeenCalled();
  });

  it("点确认走 confirm 端点，绝不额外打 cancel", async () => {
    const { onClose } = await renderUntilConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Confirm login" }));
    await flush();

    expect(calls).toContain(CONFIRM);
    expect(calls).not.toContain(CANCEL);
    expect(onClose).toHaveBeenCalled();
  });

  it("点取消必须回报服务端，否则被扫端要一直等到会话过期", async () => {
    const { onClose } = await renderUntilConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(calls).toContain(CANCEL);
    expect(calls).not.toContain(CONFIRM);
    expect(screen.queryByRole("heading", { name: "Confirm login" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("确认框开着时按安卓返回键等于放弃确认，同样回报服务端", async () => {
    await renderUntilConfirm();

    let consumed = false;
    await act(async () => {
      consumed = runBackInterceptors();
    });
    await flush();

    // 必须消费掉这次返回，否则会穿透到路由层
    expect(consumed).toBe(true);
    expect(calls).toContain(CANCEL);
    expect(screen.queryByRole("heading", { name: "Confirm login" })).not.toBeInTheDocument();
  });

  it("取景中按安卓返回键只取消扫描关相机，不打 cancel（此时还没有会话可取消）", async () => {
    const onClose = vi.fn();
    const cancelScan = vi.fn();
    // 扫描挂住不兑现：模拟相机取景中
    const scan = vi.fn(() => new Promise<string | null>(() => {}));
    render(<ScanQrEntry scan={scan} cancelScan={cancelScan} active onClose={onClose} />);
    await flush();

    let consumed = false;
    await act(async () => {
      consumed = runBackInterceptors();
    });

    expect(consumed).toBe(true);
    expect(cancelScan).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(onClose).toHaveBeenCalled();
  });

  it("取消回报失败不上屏报错：用户已经在离开这条链路了", async () => {
    routes.set(CANCEL, { status: 409, body: { code: 409, message: "auth.qrBadState" } });
    await renderUntilConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(calls).toContain(CANCEL);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
