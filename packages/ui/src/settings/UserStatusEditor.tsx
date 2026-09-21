/**
 * UserStatusEditor 组件 — 个人状态编辑弹窗（K11）
 *
 * @description
 * 三段式：emoji 预设行（必选）→ 文案输入（限 64 字，与后端 `max=64` 同口径）→
 * 有效时长四档（1 小时 / 4 小时 / 今天 / 不清除）。
 *
 * 保存走 {@link useAuthStore} 的 `updateProfile`，不直接调 `updateMyProfile`：
 * 状态要马上出现在设置页 hero 与自己的头像角标上，而那些位置读的是 store 里的 user。
 *
 * 过期由服务端读时判定（`EffectiveStatus`），前端不做定时清理，
 * 所以这里只负责把「多久之后失效」换算成秒数发过去。
 *
 * @param open - 是否显示
 * @param onClose - 关闭回调（取消、保存成功、点遮罩）
 *
 * @example
 * <UserStatusEditor open={showStatus} onClose={() => setShowStatus(false)} />
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast, useAuthStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Button } from "../primitives/Button";
import { secondsUntilEndOfDay } from "./settingsUtils";

/** 状态文案上限，与后端 `status_text` 的 `max=64` 一致 */
const TEXT_MAX = 64;

/** emoji 预设：够用就好，不挂整个表情面板（那是发消息的量级，状态只要一眼能挑中） */
const PRESET_EMOJIS = ["😀", "🌊", "💼", "🎮", "📚", "🏃", "😴", "🤒", "☕", "🎉", "✈️", "🎧"];

/** 时长档位：秒数为 0 表示不自动清除；「今天」按本地时区现算 */
const DURATIONS: { labelKey: string; seconds: () => number }[] = [
  { labelKey: "settings.userStatusDuration1h", seconds: () => 3600 },
  { labelKey: "settings.userStatusDuration4h", seconds: () => 4 * 3600 },
  { labelKey: "settings.userStatusToday", seconds: secondsUntilEndOfDay },
  { labelKey: "settings.userStatusNever", seconds: () => 0 },
];

export function UserStatusEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [emoji, setEmoji] = useState(user?.statusEmoji ?? "");
  const [text, setText] = useState(user?.statusText ?? "");
  // 默认「不清除」：手动设的状态用户通常想留着，自动过期是可选项而非默认
  const [durationIdx, setDurationIdx] = useState(DURATIONS.length - 1);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async (patch: { statusEmoji: string; statusText: string }) => {
    setSaving(true);
    try {
      await updateProfile({ ...patch, statusDuration: DURATIONS[durationIdx].seconds() });
      onClose();
    } catch {
      showToast("error", t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  /** 清除：空串即清除语义，时长一并归零，避免留下一个已无内容的过期时刻 */
  const clear = () => {
    setDurationIdx(DURATIONS.length - 1);
    void submit({ statusEmoji: "", statusText: "" });
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface-container-low w-full max-w-[360px] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-title-md text-on-surface font-semibold">{t("settings.userStatus")}</h3>

        {/* emoji 预设行：换行网格，手机窄屏也不横向溢出 */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {PRESET_EMOJIS.map((e) => (
            <button
              key={e}
              aria-label={e}
              onClick={() => setEmoji(e)}
              className={cn(
                "inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[17px] leading-none transition-colors",
                emoji === e
                  ? "bg-primary-container text-primary-on-container"
                  : "hover:bg-surface-container-high",
              )}
            >
              {e}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value.slice(0, TEXT_MAX))}
          placeholder={t("settings.userStatusPlaceholder")}
          rows={2}
          className="border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant mt-3 w-full resize-none rounded-lg border px-3 py-2"
        />
        <p className="text-label-sm text-on-surface-variant mt-1 text-right">
          {text.length}/{TEXT_MAX}
        </p>

        {/* 时长四档 */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DURATIONS.map((d, i) => (
            <button
              key={d.labelKey}
              onClick={() => setDurationIdx(i)}
              className={cn(
                "text-label-md rounded-lg px-3 py-1.5 transition-colors",
                durationIdx === i
                  ? "bg-primary-container text-primary-on-container"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
              )}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={clear}
            disabled={saving}
            className="text-label-lg text-on-surface-variant hover:bg-surface-container rounded-lg px-3 py-2 transition-colors disabled:opacity-[0.38]"
          >
            {t("settings.userStatusClear")}
          </button>
          <div className="flex gap-2">
            <Button variant="ghost" className="px-4 py-2" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              className="px-4 py-2"
              disabled={saving || !emoji}
              onClick={() => void submit({ statusEmoji: emoji, statusText: text })}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
