/**
 * VoiceRecorderBar 组件 — 录音态输入条
 *
 * @description
 * Composer 点击麦克风后替换输入行：红点脉冲 + MM:SS 计时 + 取消 / 发送。
 * mount 即开始录音（useVoiceRecorder），60s 自动截断。
 * denied 态（无权限/无设备）显示提示 + 关闭按钮。
 *
 * @param onDone - 录音完成（blob + 时长秒），交给调用方发送
 * @param onCancel - 取消录音（丢弃）
 */
import { useEffect, useRef } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { showToast, useVoiceRecorder } from "@yuanchat/shared";

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
  const { state, seconds, start, stop, cancel } = useVoiceRecorder();
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

  if (state === "denied") {
    return (
      <div className="bg-surface-container-high flex h-11 items-center gap-2 rounded-lg px-3">
        <span className="text-body-md text-error min-w-0 flex-1 truncate">
          {t("chat.voice.denied")}
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

  return (
    <div className="bg-surface-container-high flex h-11 items-center gap-3 rounded-lg px-3">
      <span className="bg-error h-2 w-2 shrink-0 animate-pulse rounded-full" />
      <span className="text-body-md text-on-surface font-medium tabular-nums">
        {formatClock(seconds)}
      </span>
      <span className="text-label-sm text-on-surface-variant min-w-0 flex-1 truncate">
        {t("chat.voice.recording")}
      </span>
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
        className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90"
        aria-label={t("chat.input.send")}
      >
        <Send size={14} />
      </button>
    </div>
  );
}
