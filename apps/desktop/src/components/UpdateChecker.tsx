/**
 * UpdateChecker — 桌面端自动更新检查（设置 → 关于 内嵌）
 *
 * @description
 * 走 tauri-plugin-updater：从 tauri.conf.json 的 endpoints 拉 latest.json，
 * 用内置 minisign 公钥校验签名（自签密钥对，免费；与 macOS 公证 / Windows
 * SmartScreen 那套付费 OS 代码签名相互独立）。
 *
 * 流程：check() → 有新版则展示版本号与下载进度 → downloadAndInstall()
 * → relaunch() 重启生效。签名校验失败会在 check/download 阶段直接抛错，
 * 不会安装未签名或被篡改的包。
 */
import { useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { RefreshCw, Download, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

type Phase = "idle" | "checking" | "available" | "downloading" | "ready" | "latest" | "error";

export function UpdateChecker() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const handleCheck = async () => {
    setPhase("checking");
    setError("");
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setPhase("available");
      } else {
        setPhase("latest");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const handleInstall = async () => {
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        // 事件流：Started(contentLength) → Progress(chunkLength)* → Finished
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setProgress(Math.round((downloaded / total) * 100));
        }
      });
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-md font-medium text-on-surface">{t("update.title")}</p>
          <p className="text-on-surface-variant mt-0.5 text-label-md">
            {phase === "latest" && t("update.upToDate")}
            {phase === "available" && t("update.available", { version: update?.version ?? "" })}
            {phase === "downloading" && t("update.downloading", { percent: progress })}
            {phase === "ready" && t("update.readyToRestart")}
            {phase === "error" && (error || t("update.failed"))}
            {(phase === "idle" || phase === "checking") && t("update.checkHint")}
          </p>
        </div>

        {phase === "ready" ? (
          <button
            onClick={() => void relaunch()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-label-lg font-medium text-primary-on"
          >
            <CheckCircle2 size={16} />
            {t("update.restart")}
          </button>
        ) : phase === "available" ? (
          <button
            onClick={() => void handleInstall()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-label-lg font-medium text-primary-on"
          >
            <Download size={16} />
            {t("update.install")}
          </button>
        ) : (
          <button
            onClick={() => void handleCheck()}
            disabled={phase === "checking" || phase === "downloading"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-label-lg font-medium text-on-surface hover:bg-surface-container disabled:opacity-50"
          >
            <RefreshCw size={16} className={phase === "checking" ? "animate-spin" : undefined} />
            {t("update.check")}
          </button>
        )}
      </div>

      {phase === "downloading" && (
        <div className="bg-surface-container-highest mt-3 h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
