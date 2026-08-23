/**
 * useVoiceRecorder — 语音录制 Hook
 *
 * @description
 * MediaRecorder 采集 audio/webm，秒表驱动 UI，60s 自动截断。
 * 失败态分三种，调用方据此给出可操作的提示：
 * - denied：用户/系统拒绝授权（浏览器地址栏可改、安卓需去设置里放开）
 * - noDevice：设备上没有可用麦克风
 * - unsupported：当前环境根本没有录音能力（非安全上下文、WebView 未开 media-stream）
 * stop() 返回 {blob, duration}；时长 < 1s 返回 null（太短丢弃）。
 * pause()/resume() 暂停与续录：MediaRecorder 暂停期间不产生数据，秒表同步停走，
 * 续录后接着同一段 blob 往后录（不是两段音频）。
 * unmount 自动 cancel（停轨道 + 清计时器）。
 *
 * 兼容性：MediaRecorder + audio/webm Chrome 49+；navigator.mediaDevices
 * 需 secure context（Tauri WebView 与 localhost 均满足）。
 * 安卓 WebView 还要求应用清单声明 RECORD_AUDIO，否则系统弹框不出现、直接判拒；
 * Linux 的 WebKitGTK 需在 Rust 侧打开 enable-media-stream 并接 permission-request。
 */
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;

export type VoiceRecorderState =
  | "idle"
  | "recording"
  | "paused"
  | "denied"
  | "noDevice"
  | "unsupported";

/**
 * 把 getUserMedia 抛出的异常归到失败态。
 *
 * @param err - getUserMedia 的 rejection
 * @returns 对应的失败态
 */
function classifyError(err: unknown): VoiceRecorderState {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "noDevice";
    // NotReadableError（设备被其他程序占用）、AbortError 等都归到「设备不可用」
    default:
      return name ? "noDevice" : "unsupported";
  }
}

export function useVoiceRecorder(): {
  state: VoiceRecorderState;
  seconds: number;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<{ blob: Blob; duration: number } | null>;
  cancel: () => void;
} {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  // stop 的 Promise resolve 挂在 ref：onstop 事件里统一 settle
  const stopResolveRef = useRef<((r: { blob: Blob; duration: number } | null) => void) | null>(
    null,
  );
  // 60s 自动截断时无人等待 stop()：结果暂存于此，后续 stop() 调用取走
  const autoResultRef = useRef<{ blob: Blob; duration: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 起秒表：每秒自增，到 MAX_SECONDS 自动截断（等价于用户主动停止） */
  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_SECONDS) {
        // 结果经 stopResolveRef 交给调用方；没人等就暂存 autoResultRef
        recorderRef.current?.stop();
        clearTimer();
      }
    }, 1000);
  }, [clearTimer]);

  const cleanup = useCallback(() => {
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [clearTimer]);

  const stop = useCallback((): Promise<{ blob: Blob; duration: number } | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanup();
      const stashed = autoResultRef.current;
      autoResultRef.current = null;
      return Promise.resolve(stashed);
    }
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });
  }, [cleanup]);

  const start = useCallback(async () => {
    setSeconds(0);
    secondsRef.current = 0;
    chunksRef.current = [];
    let stream: MediaStream;
    // 非安全上下文（http 局域网地址）和未开 media-stream 的 WebView 上
    // navigator.mediaDevices 整个对象都不存在，直接读 getUserMedia 会抛 TypeError
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setState(classifyError(err));
      return;
    }
    streamRef.current = stream;

    // MediaRecorder 缺失（旧 WebView）时不能继续，否则 new 的时候直接抛
    if (typeof MediaRecorder === "undefined") {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setState("unsupported");
      return;
    }

    const supported =
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported("audio/webm");
    const recorder = supported
      ? new MediaRecorder(stream, { mimeType: "audio/webm" })
      : new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const duration = secondsRef.current;
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      cleanup();
      setState("idle");
      const result = duration < 1 || blob.size === 0 ? null : { blob, duration };
      const resolve = stopResolveRef.current;
      stopResolveRef.current = null;
      if (resolve) resolve(result);
      else autoResultRef.current = result;
    };

    recorder.start();
    setState("recording");
    startTimer();
  }, [cleanup, startTimer]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    // 老 WebView 上 pause/resume 可能缺失，此时维持录制态（暂停按钮由调用方隐藏）
    if (!recorder || recorder.state !== "recording" || typeof recorder.pause !== "function") return;
    recorder.pause();
    clearTimer();
    setState("paused");
  }, [clearTimer]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused" || typeof recorder.resume !== "function") return;
    recorder.resume();
    setState("recording");
    startTimer();
  }, [startTimer]);

  const cancel = useCallback(() => {
    stopResolveRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    setState("idle");
    setSeconds(0);
    secondsRef.current = 0;
  }, [cleanup]);

  // unmount 清理：停轨道防麦克风占用
  useEffect(() => cancel, [cancel]);

  return { state, seconds, start, pause, resume, stop, cancel };
}
