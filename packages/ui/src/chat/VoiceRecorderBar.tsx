/**
 * VoiceRecorderBar 组件 — 录音态输入条
 *
 * @description
 * Composer 点击麦克风后替换输入行：红点脉冲 + MM:SS 计时 + 暂停 / 取消 / 发送。
 * mount 即开始录音（useVoiceRecorder），60s 自动截断。
 * 暂停后红点停闪、秒表停走，续录接着同一段录音往后录。
 * 失败态（拒绝授权 / 无麦克风 / 环境不支持）分别给出可操作的提示 + 关闭按钮。
 *
 * @param onDone - 录音完成（blob + 时长秒），交给调用方发送
 * @param onCancel - 取消录音（丢弃）
 */
import { useEffect, useRef } from "react";
import { Mic, Pause, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { showToast, useVoiceRecorder } from "@yuanchat/shared";
import type { VoiceRecorderState } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 失败态 → 提示文案 key */
const ERROR_KEY: Record<"denied" | "noDevice" | "unsupported", string> = {
  denied: "chat.voice.denied",
  noDevice: "chat.voice.noDevice",
  unsupported: "chat.voice.unsupported",
};

function isErrorState(state: VoiceRecorderState): state is "denied" | "noDevice" | "unsupported" {
  return state === "denied" || state === "noDevice" || state === "unsupported";
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export function VoiceRecorderBar({
  onDone,
  onCancel,
}: {
  onDone: (blob: Blob, duration: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { state, seconds, start, pause, resume, stop, cancel } = useVoiceRecorder();
  const startedRef = useRef(false);

  // mount 即开始录音（一次性）
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const handleSend = () => {
    void stop().then((result) => {
      if (!result) {
        showToast("info", t("chat.voice.tooShort"));
        onCancel();
        return;
      }
      onDone(result.blob, result.duration);
    });
  };

  if (isErrorState(state)) {
    return (
      <div className="bg-surface-container-high flex h-11 items-center gap-2 rounded-lg px-3">
        <span className="text-body-md text-error min-w-0 flex-1 truncate">
          {t(ERROR_KEY[state])}
        </span>
        <button
          onClick={onCancel}
          className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
          aria-label={t("common.cancel")}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const paused = state === "paused";

  return (
    <div className="bg-surface-container-high flex h-11 items-center gap-2 rounded-lg px-3">
      {/* 暂停时红点停闪，一眼能看出没在录 */}
      <span className={cn("bg-error h-2 w-2 shrink-0 rounded-full", !paused && "animate-pulse")} />
      <span className="text-body-md text-on-surface font-medium tabular-nums">
        {formatClock(seconds)}
      </span>
      <span className="text-label-sm text-on-surface-variant min-w-0 flex-1 truncate">
        {t(paused ? "chat.voice.paused" : "chat.voice.recording")}
      </span>
      <button
        onClick={() => (paused ? resume() : pause())}
        className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
        aria-label={t(paused ? "chat.voice.resume" : "chat.voice.pause")}
      >
        {/* 图标只有描边，小尺寸下细到看不清，统一填充 */}
        {paused ? <Mic size={16} /> : <Pause size={16} fill="currentColor" />}
      </button>
      <button
        onClick={() => {
          cancel();
          onCancel();
        }}
        className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
        aria-label={t("common.cancel")}
      >
        <X size={16} />
      </button>
      <button
        onClick={handleSend}
        className="brand-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-90"
        aria-label={t("chat.input.send")}
      >
        <Send size={14} />
      </button>
    </div>
  );
}
