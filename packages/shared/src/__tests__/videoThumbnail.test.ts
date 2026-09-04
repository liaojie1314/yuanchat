/**
 * 视频缩略图抽帧回归测试（`extractVideoMeta` / `captureVideoFrame`）
 *
 * @description
 * 真机（真实后端 + 640x360/6s mp4）实测到的缺陷：抽出来的 JPEG 是**纯黑**
 * （PIL 量出 `min=0 max=0 avg=0`），而同一视频同一时间点在 `seeked` 之后亮度是 127。
 * 根因是等待策略把 `seeked` 与 `loadeddata` 放进竞速，真机事件序为
 * `loadedmetadata(rs4) → loadeddata(rs1) → canplay(rs1) → seeked(rs4)`，
 * `loadeddata` 先到时 readyState=1，目标帧尚未解码，`drawImage` 画到的是空白。
 *
 * 「产出了一个 blob」这类断言抓不到该缺陷——纯黑图也是合法 JPEG。故本文件断言
 * **像素内容**（非纯黑 + 有方差）与**顺序契约**（readyState < 2 时不得绘制）。
 *
 * shared 的测试环境是 node（无 DOM、无视频解码），因此用可编程的 `<video>` /
 * `<canvas>` 替身：替身的"当前帧"就是一组像素值，未解码时全 0（与浏览器给出的空白帧一致），
 * `seeked` 后才变成非黑图样。替身不模拟解码，只复刻**事件顺序与 readyState 变化**——
 * 而缺陷恰恰全部发生在这一层。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractVideoMeta } from "../api/files";

/** 未解码时的帧：浏览器给出的空白帧，全 0 */
const BLANK_FRAME = [0, 0, 0, 0, 0, 0, 0, 0];

/** 解码后的合成帧：非纯黑且有明暗变化（对应真机量到的 avg=127） */
const DECODED_FRAME = [8, 64, 127, 200, 250, 96, 32, 180];

/** 抽帧场景：真机事件序 / 不发 seeked 的 WebView / 帧数据始终不到位 */
type SeekBehavior = "real" | "noSeekedEvent" | "neverReady";

/** 一次 drawImage 的现场记录：当时的 readyState 与被绘制的帧像素 */
interface DrawRecord {
  readyState: number;
  pixels: number[];
}

const draws: DrawRecord[] = [];
/** 事件与绘制的时间线，用于断言「绘制发生在 seeked 之后」 */
let timeline: string[] = [];
let behavior: SeekBehavior = "real";

/** 可编程 <video> 替身：readyState、事件顺序、当前帧像素全由场景摆布 */
class FakeVideo {
  preload = "";
  muted = false;
  playsInline = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  duration = NaN;
  /** 当前"可绘制"帧的像素；未解码时是 BLANK_FRAME */
  framePixels: number[] = BLANK_FRAME;

  private listeners: Record<string, Set<() => void>> = {};
  private time = 0;

  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= new Set()).add(fn);
  }

  removeEventListener(type: string, fn: () => void) {
    this.listeners[type]?.delete(fn);
  }

  private emit(type: string) {
    timeline.push(type + "@rs" + this.readyState);
    for (const fn of [...(this.listeners[type] ?? [])]) fn();
  }

  set src(_v: string) {
    // 本地 blob 一上来就整段可用：真机实测 loadedmetadata 时 readyState 已是 4
    this.videoWidth = 640;
    this.videoHeight = 360;
    this.duration = 6;
    this.readyState = 4;
    this.emit("loadedmetadata");
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(t: number) {
    this.time = t;
    // seek 开始：帧数据作废，readyState 掉到 HAVE_METADATA，画出来必然是空白
    this.readyState = 1;
    this.framePixels = BLANK_FRAME;
    this.emit("loadeddata");
    this.emit("canplay");

    if (behavior === "neverReady") return;

    setTimeout(() => {
      // 目标帧解码完成
      this.readyState = 4;
      this.framePixels = DECODED_FRAME;
      // 不发 seeked 的 WebView：数据到位但事件缺失，只能靠 readyState 轮询发现
      if (behavior === "real") this.emit("seeked");
    }, 30);
  }

  removeAttribute(_name: string) {}

  load() {}
}

/** 可编程 <canvas> 替身：drawImage 记录现场，toBlob 把像素原样序列化出去 */
class FakeCanvas {
  width = 0;
  height = 0;
  private pixels: number[] = [];

  getContext(kind: string) {
    if (kind !== "2d") return null;
    return {
      drawImage: (src: FakeVideo) => {
        timeline.push("drawImage@rs" + src.readyState);
        this.pixels = [...src.framePixels];
        draws.push({ readyState: src.readyState, pixels: this.pixels });
      },
    };
  }

  toBlob(cb: (b: Blob | null) => void, type: string) {
    cb(new Blob([JSON.stringify(this.pixels)], { type }));
  }
}

/** 缩略图 blob → 像素数组（替身把画进 canvas 的像素原样写进 blob） */
async function thumbnailPixels(blob: Blob): Promise<number[]> {
  return JSON.parse(await blob.text()) as number[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 方差：纯黑图为 0，正常封面必然大于 0 */
const variance = (xs: number[]) => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) * (x - m)));
};

beforeEach(() => {
  vi.useFakeTimers();
  draws.length = 0;
  timeline = [];
  behavior = "real";
  vi.stubGlobal("URL", { createObjectURL: () => "blob:v", revokeObjectURL: () => {} });
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "video" ? new FakeVideo() : new FakeCanvas()),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("extractVideoMeta 抽帧", () => {
  it("真机事件序下抽到的是解码后的帧，不是纯黑（黑封面回归）", async () => {
    const p = extractVideoMeta(new Blob(["mp4"], { type: "video/mp4" }));
    await vi.advanceTimersByTimeAsync(100);
    const meta = await p;

    expect(meta).toMatchObject({ duration: 6, width: 640, height: 360 });

    // 像素断言：纯黑图（旧实现的产物）均值与方差都是 0
    const pixels = await thumbnailPixels(meta.thumbnail);
    expect(mean(pixels)).toBeGreaterThan(0);
    expect(variance(pixels)).toBeGreaterThan(0);
    expect(pixels).toEqual(DECODED_FRAME);

    // 顺序契约：只绘制一次，且必在 seeked 之后、readyState 达标时
    expect(draws).toHaveLength(1);
    expect(draws[0].readyState).toBeGreaterThanOrEqual(2);
    expect(timeline).toEqual([
      "loadedmetadata@rs4",
      "loadeddata@rs1",
      "canplay@rs1",
      "seeked@rs4",
      "drawImage@rs4",
    ]);
  });

  it("readyState 不足时不得绘制：loadeddata 先到也不能触发抽帧", async () => {
    const p = extractVideoMeta(new Blob(["mp4"], { type: "video/mp4" }));
    // loadeddata / canplay 都已在 rs1 发出，此时若绘制就是黑图
    await vi.advanceTimersByTimeAsync(10);
    expect(timeline).toContain("loadeddata@rs1");
    expect(draws).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(draws).toHaveLength(1);
  });

  it("不发 seeked 的 WebView：等超时后按 readyState 判定抽帧，仍非纯黑", async () => {
    behavior = "noSeekedEvent";
    const p = extractVideoMeta(new Blob(["mp4"], { type: "video/mp4" }));
    // seek 等待期内不绘制（帧数据 30ms 后才到，事件永不来）
    await vi.advanceTimersByTimeAsync(10);
    expect(draws).toHaveLength(0);

    // seeked 超时（10s）后走 readyState 闸门：此时帧已解码 → 直接抽
    await vi.advanceTimersByTimeAsync(11_000);
    const meta = await p;

    const pixels = await thumbnailPixels(meta.thumbnail);
    expect(mean(pixels)).toBeGreaterThan(0);
    expect(draws).toHaveLength(1);
    expect(draws[0].readyState).toBeGreaterThanOrEqual(2);
    expect(timeline).not.toContain("seeked@rs4");
  });

  it("帧数据始终不到位：宽限用尽后退化出图，不因此让整条消息发失败", async () => {
    behavior = "neverReady";
    const p = extractVideoMeta(new Blob(["mp4"], { type: "video/mp4" }));

    // seeked 超时（10s）+ readyState 宽限（1.5s）都耗尽
    await vi.advanceTimersByTimeAsync(11_000);
    expect(draws).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);

    // 关键：resolve 而不是 reject —— thumb_key 是服务端必填字段，
    // 抽帧抛错等于整条视频消息发不出去（暗封面 > 发不出去）
    const meta = await p;
    expect(meta.thumbnail).toBeInstanceOf(Blob);
    expect(draws).toHaveLength(1);
    // 这一帧确实是空白，但它是"尽力而为"的结果，而非可避免的黑图
    expect(draws[0].readyState).toBeLessThan(2);
  });
});
