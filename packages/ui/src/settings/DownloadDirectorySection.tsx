/** 默认下载目录设置：首次由用户选择，失效后由用户重新授权。 */
import { useEffect, useState } from "react";
import { Check, FolderDown, FolderOpen, Info, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  captureException,
  getFileSink,
  refreshDownloads,
  chooseBrowserDownloadDirectory,
  loadBrowserDownloadDirectory,
  setBrowserDownloadDirectory,
  supportsBrowserDownloadDirectory,
  useIsDesktop,
  type BrowserDownloadDirectory,
  type DownloadDirectory,
} from "@yuanchat/shared";
import { Button } from "../primitives/Button";

/** 三端目录设置：桌面使用原生选择器，Web 授权目录，移动端保留应用私有目录。 */
export function DownloadDirectorySection() {
  const { t } = useTranslation();
  const native = useIsDesktop();
  const supported = supportsBrowserDownloadDirectory();
  const nativeSettings = native ? getFileSink().downloadDirectory : undefined;
  const canChoose = !!nativeSettings || (!native && supported);
  const [directory, setDirectory] = useState<BrowserDownloadDirectory | null>(null);
  const [nativeDirectory, setNativeDirectory] = useState<DownloadDirectory | null>(null);
  const [permission, setPermission] = useState<PermissionState>("prompt");
  const [loading, setLoading] = useState(canChoose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canChoose) return;
    let active = true;
    void (async () => {
      if (nativeSettings) {
        const result = await nativeSettings.get();
        if (active) setNativeDirectory(result);
      } else {
        const handle = await loadBrowserDownloadDirectory();
        const granted = handle ? await handle.queryPermission({ mode: "readwrite" }) : "prompt";
        if (active) {
          setDirectory(handle);
          setPermission(granted);
        }
      }
    })()
      .catch((reason) => {
        captureException(reason, { context: "downloadDirectory.load" });
        if (active) setError("download.directoryFailed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canChoose, nativeSettings]);

  /** 只在用户动作中调用目录选择或权限请求，取消不会清掉已有设置。 */
  const change = async (action: "choose" | "authorize" | "reset") => {
    setBusy(true);
    setError(null);
    try {
      if (nativeSettings) {
        const result =
          action === "reset" ? await nativeSettings.reset() : await nativeSettings.choose();
        if (result) {
          setNativeDirectory(result);
          await refreshDownloads();
        }
        return;
      }
      if (action === "choose") {
        const handle = await chooseBrowserDownloadDirectory();
        setDirectory(handle);
        setPermission("granted");
      } else if (action === "authorize" && directory) {
        const granted = await directory.requestPermission({ mode: "readwrite" });
        setPermission(granted);
        if (granted !== "granted") setError("download.directoryPermissionRequired");
      } else if (action === "reset") {
        await setBrowserDownloadDirectory(null);
        setDirectory(null);
        setPermission("prompt");
      }
    } catch (reason) {
      if (!(reason instanceof DOMException) || reason.name !== "AbortError") {
        captureException(reason, { context: "downloadDirectory.change" });
        setError("download.directoryFailed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-busy={loading || busy}>
      <h3 className="text-title-sm text-on-surface font-semibold">{t("download.settingsTitle")}</h3>
      <div className="border-outline-variant bg-surface-container-lowest overflow-hidden rounded-lg border">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-4">
            <span
              className="bg-primary-container/60 text-primary flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-lg"
              aria-hidden="true"
            >
              <FolderDown size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-label-md text-on-surface-variant mb-1">
                {t("download.directoryTitle")}
              </p>
              <div
                role="status"
                className="text-title-sm text-on-surface flex min-h-[24px] min-w-0 items-center font-semibold"
              >
                {loading ? (
                  <span
                    className="bg-surface-container-high h-[20px] w-40 animate-pulse rounded"
                    aria-label={t("common.loading")}
                  />
                ) : (
                  <span className="truncate" title={nativeDirectory?.path ?? directory?.name}>
                    {native
                      ? (nativeDirectory?.path ?? t("download.directoryNativeName"))
                      : (directory?.name ?? t("download.directoryDefault"))}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="text-body-md text-on-surface-variant leading-relaxed">
            {t(
              native && !nativeSettings
                ? "download.directoryNative"
                : nativeSettings || supported
                  ? "download.directoryDescription"
                  : "download.directoryUnsupported",
            )}
          </p>
          {canChoose && (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {directory && permission !== "granted" && (
                <Button type="button" disabled={busy} onClick={() => void change("authorize")}>
                  {t("download.directoryAuthorize")}
                </Button>
              )}
              <Button
                type="button"
                variant={directory || nativeDirectory?.custom ? "secondary" : "primary"}
                disabled={loading || busy}
                className="gap-2"
                onClick={() => void change("choose")}
              >
                <FolderOpen size={18} aria-hidden="true" />
                {t("download.directoryChoose")}
              </Button>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="bg-error-container text-error-on-container text-body-sm flex items-start gap-2 rounded-lg p-3"
            >
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t(error)}
            </p>
          )}
        </div>
        {canChoose && (directory || nativeDirectory?.custom) && (
          <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 sm:px-5">
            <p className="text-label-md text-on-surface-variant flex items-center gap-2">
              {nativeSettings || permission === "granted" ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Info size={16} aria-hidden="true" />
              )}
              {t(
                nativeSettings || permission === "granted"
                  ? "download.directoryReady"
                  : "download.directoryNeedsAuthorization",
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="text-primary px-2 py-2"
              onClick={() => void change("reset")}
            >
              {t(nativeSettings ? "download.directoryResetNative" : "download.directoryReset")}
            </Button>
          </div>
        )}
      </div>
      {canChoose && (
        <p className="text-body-sm text-on-surface-variant flex items-start gap-2 px-1 leading-relaxed">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(nativeSettings ? "download.directoryDesktopHint" : "download.directoryPrivacyHint")}
        </p>
      )}
    </section>
  );
}
