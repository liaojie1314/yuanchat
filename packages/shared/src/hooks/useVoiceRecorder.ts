/**
 * useVoiceRecorder — 语音录制 Hook
 *
 * @description
 * MediaRecorder 采集 audio/webm，秒表驱动 UI，60s 自动截断。
 * denied 态：getUserMedia 被拒（无权限/无设备），调用方展示提示。
 * stop() 返回 {blob, duration}；时长 < 1s 返回 null（太短丢弃）。
 * unmount 自动 cancel（停轨道 + 清计时器）。
 *
 * 兼容性：MediaRecorder + audio/webm Chrome 49+；navigator.mediaDevices
 * 需 secure context（Tauri WebView 与 localhost 均满足）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;

export type VoiceRecorderState = "idle" | "recording" | "denied";

export function useVoiceRecorder(): {
  state: VoiceRecorderState;
  seconds: number;
  start: () => Promise<void>;
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

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

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
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    streamRef.current = stream;

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
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_SECONDS) {
        // 60s 自动截断：等价于用户主动停止；结果经 stopResolveRef 交给调用方
        recorderRef.current?.stop();
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }, 1000);
  }, [cleanup]);

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

  return { state, seconds, start, stop, cancel };
}
