/** 搜索快捷键设置：直接记录组合、提示冲突，并提供恢复默认的回头路。 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_SEARCH_SHORTCUT,
  getShortcutError,
  shortcutFromEvent,
  useShortcutStore,
} from "@yuanchat/shared";

/** Web 与桌面设置页共用的键盘偏好；仅改本机，不请求服务器。 */
export function ShortcutSection() {
  const { t } = useTranslation();
  const id = useId();
  const shortcut = useShortcutStore((state) => state.searchShortcut);
  const save = useShortcutStore((state) => state.setSearchShortcut);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<"shortcuts.invalid" | "shortcuts.reserved" | null>(null);
  const mac = /Macintosh|Mac OS/.test(navigator.userAgent);
  const label = [
    mac ? "⌘" : t("shortcuts.ctrl"),
    ...(shortcut.alt ? [t("shortcuts.alt")] : []),
    ...(shortcut.shift ? [t("shortcuts.shift")] : []),
    shortcut.key.toUpperCase(),
  ].join("+");

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-title-sm text-on-surface font-semibold">{t("shortcuts.title")}</h3>
      <p id={`${id}-hint`} className="text-body-sm text-on-surface-variant">
        {t("shortcuts.description")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-body-md text-on-surface">
          {t("shortcuts.search")}
        </label>
        <input
          id={id}
          readOnly
          value={recording ? t("shortcuts.record") : label}
          aria-describedby={`${id}-hint`}
          className="border-outline-variant bg-surface text-on-surface w-[180px] max-w-full rounded-lg border px-3 py-2"
          onFocus={() => {
            setRecording(true);
            setError(null);
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (event.key === "Tab") return;
            // 录制时不能让组合继续冒泡到 MainLayout，否则会打开搜索打断输入。
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
              event.currentTarget.blur();
              return;
            }
            if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
            const next = shortcutFromEvent(event.nativeEvent);
            const problem = next ? getShortcutError(next) : "shortcuts.invalid";
            setError(problem);
            if (!problem && next) {
              save(next);
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="text-primary text-label-md rounded-lg px-3 py-2"
          onClick={() => {
            save(DEFAULT_SEARCH_SHORTCUT);
            setError(null);
          }}
        >
          {t("shortcuts.reset")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-error text-body-sm">
          {t(error)}
        </p>
      )}
    </section>
  );
}
