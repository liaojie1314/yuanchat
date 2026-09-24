/**
 * 语音录制失败态单元测试
 *
 * 放在 ui 包：hook 属于 shared，但只有 ui 装了 jsdom 与 @testing-library/react。
 *
 * 背景：麦克风拿不到时以前统一显示「无权限」，用户按提示去改权限却发现权限是开的
 * （真实原因可能是安卓清单没声明 RECORD_AUDIO、WebKitGTK 没开 media-stream、
 * 或者页面走的是非安全上下文）。失败态拆成拒绝 / 无设备 / 环境不支持三种，
 * 提示才对得上真实原因。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoiceRecorder } from "@yuanchat/shared";

/** 造一个带 name 的 DOMException 风格错误（getUserMedia 就是这么抛的） */
function mediaError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

/** 替换 navigator.mediaDevices，返回还原函数 */
function stubMediaDevices(value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
  return () => {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  };
}

describe("useVoiceRecorder 失败态", () => {
  const restores: (() => void)[] = [];

  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("被拒绝授权 → denied", async () => {
    restores.push(
      stubMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(mediaError("NotAllowedError")) }),
    );
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("设备上没有麦克风 → noDevice", async () => {
    restores.push(
      stubMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(mediaError("NotFoundError")) }),
    );
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("noDevice"));
  });

  it("麦克风被别的程序占用 → noDevice", async () => {
    restores.push(
      stubMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(mediaError("NotReadableError")) }),
    );
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("noDevice"));
  });

  // 非安全上下文（http 局域网地址）与未开 media-stream 的 WebView 上
  // navigator.mediaDevices 整个对象都不存在，此时读属性就会抛 TypeError，
  // 不能等到 getUserMedia 的 rejection 才判断
  it("环境没有 mediaDevices → unsupported，且不抛异常", async () => {
    restores.push(stubMediaDevices(undefined));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("有 mediaDevices 但没有 getUserMedia → unsupported", async () => {
    restores.push(stubMediaDevices({}));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });
});

/** 假的 MediaRecorder：只维护 state 并在 stop 时吐一段数据 */
class FakeMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.onstop?.();
  }
  static isTypeSupported() {
    return true;
  }
}

describe("useVoiceRecorder 暂停与续录", () => {
  const restores: (() => void)[] = [];

  afterEach(() => {
    while (restores.length) restores.pop()?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 装好假麦克风与假 MediaRecorder，返回已开录的 hook */
  async function startedRecorder() {
    restores.push(
      stubMediaDevices({
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      }),
    );
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    return result;
  }

  it("暂停期间秒表停走，续录后接着走", async () => {
    const result = await startedRecorder();
    expect(result.current.state).toBe("recording");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.seconds).toBe(2);

    act(() => {
      result.current.pause();
    });
    expect(result.current.state).toBe("paused");

    // 暂停中计时器已停：再走 3 秒也不涨（否则时长会把静音算进去）
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(2);

    act(() => {
      result.current.resume();
    });
    expect(result.current.state).toBe("recording");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(3);
  });

  it("暂停中直接发送也能拿到录音结果", async () => {
    const result = await startedRecorder();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.pause();
    });

    let payload: { blob: Blob; duration: number } | null = null;
    await act(async () => {
      payload = await result.current.stop();
    });
    expect(payload).not.toBeNull();
    expect(payload!.duration).toBe(2);
    expect(payload!.blob.size).toBeGreaterThan(0);
  });
});
