/**
 * voicePlayer 单例与倍速播放单元测试
 *
 * 锁死三条容易回退的行为：
 * 1. 新播放要带上全局倍速（否则「调了 1.5x，下一条又回 1x」）
 * 2. 播放中改倍速立即生效，且不打断播放
 * 3. stopVoice 不重置倍速（倍速是用户偏好，不是本次播放的一次性设置）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getVoiceRate,
  nextVoiceRate,
  playVoice,
  setVoiceRate,
  stopVoice,
  subscribeVoicePlayer,
  voicePlayerState,
} from "../voicePlayer";

/** 替身音频：jsdom 未实现 HTMLMediaElement.play，且需要断言 playbackRate */
class FakeAudio {
  static last: FakeAudio | null = null;
  src: string;
  playbackRate = 1;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src: string) {
    this.src = src;
    FakeAudio.last = this;
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

beforeEach(() => {
  FakeAudio.last = null;
  vi.stubGlobal("Audio", FakeAudio);
  // 模块级单例状态跨用例存活：先归零
  stopVoice();
  setVoiceRate(1);
});

afterEach(() => {
  stopVoice();
  setVoiceRate(1);
  vi.unstubAllGlobals();
});

describe("voicePlayer 倍速", () => {
  it("nextVoiceRate 按 1 → 1.5 → 2 → 1 循环（显式档位表）", () => {
    expect(nextVoiceRate(1)).toBe(1.5);
    expect(nextVoiceRate(1.5)).toBe(2);
    expect(nextVoiceRate(2)).toBe(1);
  });

  it("新播放继承当前全局倍速", async () => {
    setVoiceRate(1.5);
    await playVoice("m1", "blob:a");
    expect(FakeAudio.last?.playbackRate).toBe(1.5);
    expect(FakeAudio.last?.paused).toBe(false);
  });

  it("播放中调倍速立即作用到当前音频，且不暂停", async () => {
    await playVoice("m1", "blob:a");
    expect(FakeAudio.last?.playbackRate).toBe(1);

    setVoiceRate(2);
    expect(FakeAudio.last?.playbackRate).toBe(2);
    expect(FakeAudio.last?.paused).toBe(false);
    expect(voicePlayerState()).toEqual({ playingId: "m1", rate: 2 });
  });

  it("stopVoice 不重置倍速，下一条语音仍按该倍速播", async () => {
    setVoiceRate(2);
    await playVoice("m1", "blob:a");
    stopVoice();

    expect(getVoiceRate()).toBe(2);
    await playVoice("m2", "blob:b");
    expect(FakeAudio.last?.src).toBe("blob:b");
    expect(FakeAudio.last?.playbackRate).toBe(2);
  });

  it("订阅回调同时收到 playingId 与 rate", async () => {
    const seen: { playingId: string | null; rate: number }[] = [];
    const off = subscribeVoicePlayer((st) => seen.push({ ...st }));

    await playVoice("m1", "blob:a");
    setVoiceRate(1.5);
    stopVoice();
    off();

    expect(seen[0]).toEqual({ playingId: "m1", rate: 1 });
    expect(seen[1]).toEqual({ playingId: "m1", rate: 1.5 });
    expect(seen[seen.length - 1]).toEqual({ playingId: null, rate: 1.5 });
  });

  it("同一条再点即停止（toggle）", async () => {
    await playVoice("m1", "blob:a");
    const el = FakeAudio.last;
    await playVoice("m1", "blob:a");
    expect(el?.paused).toBe(true);
    expect(voicePlayerState().playingId).toBeNull();
  });
});
