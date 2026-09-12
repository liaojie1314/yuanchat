/**
 * ringtone 单测
 *
 * @description
 * 只验「autoplay 策略下能不能真的响」这一件事：被叫侧没有用户手势，
 * AudioContext 会停在 suspended，不 resume 就是静音来电 —— 而静音来电和「没收到来电」
 * 在用户看来完全一样，是本模块唯一致命的失败模式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ringtone } from "../webrtc/ringtone";

const resume = vi.fn(async () => {});
const started: unknown[] = [];

class FakeCtx {
  state = "suspended";
  currentTime = 0;
  destination = {};
  resume = resume;
  close = vi.fn(async () => {});
  createOscillator = () => {
    const osc = {
      type: "",
      frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(() => started.push(osc)),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    return osc;
  };
  createGain = () => ({
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
}

describe("ringtone", () => {
  beforeEach(() => {
    resume.mockClear();
    started.length = 0;
    (globalThis as unknown as Record<string, unknown>).AudioContext = FakeCtx;
    ringtone.__reset();
  });

  afterEach(() => {
    ringtone.stop();
  });

  it("AudioContext 处于 suspended 时会先 resume 再响", async () => {
    ringtone.primeOnFirstGesture();
    ringtone.playIncoming();
    await Promise.resolve();
    // 被叫侧没有用户手势，autoplay 策略会让 AudioContext 停在 suspended —— 不 resume 就是静音来电
    expect(resume).toHaveBeenCalled();
    expect(started.length).toBeGreaterThan(0);
    ringtone.stop();
  });

  it("来电铃是双音，呼出回铃是单音", () => {
    ringtone.playIncoming();
    const incomingOscs = started.length;
    ringtone.stop();
    started.length = 0;
    ringtone.playOutgoing();
    expect(incomingOscs).toBe(2);
    expect(started.length).toBe(1);
    ringtone.stop();
  });

  it("stop 停掉振荡器并取消震动", () => {
    const vibrate = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrate;
    ringtone.playIncoming();
    expect(vibrate).toHaveBeenCalled();
    vibrate.mockClear();
    ringtone.stop();
    // 不显式传 0 的话，安卓上震动会一直持续到系统超时
    expect(vibrate).toHaveBeenCalledWith(0);
  });

  it("没有 AudioContext 的环境不抛错（老 WebView 兜底）", () => {
    ringtone.stop();
    ringtone.__reset();
    delete (globalThis as unknown as Record<string, unknown>).AudioContext;
    expect(() => ringtone.playIncoming()).not.toThrow();
    expect(() => ringtone.stop()).not.toThrow();
  });
});
