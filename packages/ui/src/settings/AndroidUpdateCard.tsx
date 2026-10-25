/**
 * AndroidUpdateCard — 安卓应用内自绘更新卡（设置 → 关于 内嵌）。
 *
 * @description
 * Tauri updater 插件不支持 Android（见 apps/desktop/src/android/otaUpdater.ts
 * 的模块注释），所以更新说明、进度、按钮全部**应用内自绘**，不弹任何原生框。
 *
 * 行为注入而非组件内直连：本组件在 @yuanchat/ui，不能反向 import app 层的
 * otaUpdater（那里才有 @tauri-apps/api/core），所以 `check` / `install` 由
 * SettingsPage 传入。进度条真源是 shared 的 useDownloadStore（键 `ota-<version>`），
 * 与文件下载共用同一套 UI。
 *
 * 权限说明（permissionNote）刻意常驻可见：系统安装器首次会要求
 * 「允许安装未知应用」，不提前讲清，用户会以为应用在越权做什么。
 */
import { useState } from "react";
import { CheckCircle2, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OTA_SHA256_MISMATCH, useDownloadStore, type AndroidUpdate } from "@yuanchat/shared";
import { FileProgressBar } from "../chat/FileProgressBar";

/** 卡片状态机：检查 → 可更新 → 下载 → 校验/安装（或各种失败回落） */
type Phase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "verifyFailed"
  | "error";

interface Props {
  /** 当前版本号（检查更新的比较基准，构建期注入） */
  currentVersion: string;
  /** 检查更新；由 app 层注入 otaUpdater.checkAndroidUpdate */
  check: (currentVersion: string) => Promise<AndroidUpdate | null>;
  /** 下载 → 校验 → 唤起系统安装器；由 app 层注入 otaUpdater.downloadAndInstall */
  install: (update: AndroidUpdate) => Promise<void>;
}

export function AndroidUpdateCard({ currentVersion, check, install }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<AndroidUpdate | null>(null);
  const [error, setError] = useState("");

  // 进度真源在 shared store：键 ota-<version>，与文件下载进度条同一套 UI
  const messageId = update ? `ota-${update.version}` : "";
  const entry = useDownloadStore((s) => s.entries[messageId]);
  // saving 是字节收齐后落盘/校验的窗口期，此时文案换成「正在校验」
  const verifying = entry?.phase === "saving";

  const handleCheck = async () => {
    setPhase("checking");
    setError("");
    try {
      const found = await check(currentVersion);
      if (found) {
        setUpdate(found);
        setPhase("available");
      } else {
        setPhase("upToDate");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const handleInstall = async () => {
    if (!update) return;
    setPhase("downloading");
    setError("");
    try {
      await install(update);
      setPhase("installing");
    } catch (e) {
      if (e instanceof Error && e.message === OTA_SHA256_MISMATCH) {
        // 校验没过：措辞必须比普通网络错误重 —— 意味着下载源可能被篡改
        setPhase("verifyFailed");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  /** 「稍后」：收起更新体回到未检查态，mandatory 时不渲染这个按钮 */
  const dismiss = () => {
    setUpdate(null);
    setPhase("idle");
  };

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <div className="border-outline-variant bg-surface-container-low mb-6 rounded-lg border p-4">
      {/* 标题行：状态文案 + 主按钮，堆叠布局（手机端竖向空间充裕） */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-md text-on-surface font-medium">{t("ota.android.title")}</p>

        {phase === "installing" ? (
          <span className="text-label-lg text-primary inline-flex shrink-0 items-center gap-1.5">
            <CheckCircle2 size={16} />
            {t("ota.android.installing")}
          </span>
        ) : phase === "available" ? (
          <button
            onClick={() => void handleInstall()}
            className="bg-primary text-primary-on text-label-lg inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-medium"
          >
            <Download size={16} />
            {t("ota.android.updateNow")}
          </button>
        ) : (
          <button
            onClick={() => void handleCheck()}
            disabled={busy}
            className="border-outline-variant text-on-surface hover:bg-surface-container text-label-lg inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={phase === "checking" ? "animate-spin" : undefined} />
            {t("update.check")}
          </button>
        )}
      </div>

      {/* 状态副文案：idle 检查提示 / upToDate / 出错；可更新时展示新版本号 */}
      <p className="text-label-md text-on-surface-variant mt-0.5">
        {phase === "idle" && t("update.checkHint")}
        {phase === "checking" && t("update.checkHint")}
        {phase === "upToDate" && t("ota.android.upToDate")}
        {phase === "error" && (error || t("update.failed"))}
        {phase === "available" && update && `v${update.version}`}
        {phase === "verifyFailed" && (
          <span className="text-error inline-flex items-center gap-1">
            <ShieldAlert size={14} />
            {t("ota.android.verifyFailed")}
          </span>
        )}
      </p>

      {/* 更新说明：服务端下发的 notes 是内容不是界面文案，直接展示不进 i18n */}
      {phase === "available" && update && (
        <div className="mt-3">
          {update.notes.trim() !== "" && (
            <>
              <p className="text-label-lg text-on-surface font-medium">{t("ota.android.body")}</p>
              <p className="text-body-sm text-on-surface-variant mt-1 whitespace-pre-wrap">
                {update.notes}
              </p>
            </>
          )}

          {/* 安全机制说明常驻：首次安装系统必问「允许安装未知应用」 */}
          <p className="text-label-md text-on-surface-variant mt-3">
            {t("ota.android.permissionNote")}
          </p>

          {/* mandatory = 服务端要求必装，不给「稍后」 */}
          {!update.mandatory && (
            <button
              onClick={dismiss}
              disabled={busy}
              className="border-outline-variant text-on-surface hover:bg-surface-container text-label-lg mt-3 w-full rounded-lg border px-3 py-2 font-medium disabled:opacity-50"
            >
              {t("ota.android.later")}
            </button>
          )}
        </div>
      )}

      {/* 下载进度：条 + 百分比来自 shared store；校验窗口期换「正在校验」文案 */}
      {phase === "downloading" && (
        <div className="mt-3">
          <p className="text-label-md text-on-surface-variant">
            {verifying ? t("ota.android.verifying") : t("ota.android.downloading")}
          </p>
          <FileProgressBar messageId={messageId} />
        </div>
      )}
    </div>
  );
}
