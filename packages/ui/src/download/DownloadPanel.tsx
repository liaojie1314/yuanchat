/**
 * DownloadPanel — Web 端客户端下载面板（侧栏沉底入口 / 手机设置项打开的浮层）。
 *
 * @description
 * 数据源是 /updates/catalog（app_releases 表），不硬编码 GitHub Releases ——
 * 否则同一份版本信息两处维护，迟早漂。表里没有 published 版本时走空态
 * 并给 GitHub 兜底链接。
 *
 * 推荐逻辑：平台与架构共同匹配，当前系统与其他平台保留可见分组，
 * 推荐包用紧凑行；同系统的其他架构仍归当前系统，无包平台保留禁用行。
 * 下载按钮是 `<a href download>` —— 走浏览器原生下载，
 * 不走应用内下载器：web 端装包本来就该交给浏览器。
 *
 * 加载态是**固定高度骨架屏**而非 spinner：容器高度钉死，数据到达时面板不跳（零 CLS）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { captureException, fetchCatalog, type CatalogEntry } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { detectPlatform, detectArchitecture, type DetectedArchitecture } from "./detectPlatform";

/** GitHub Releases 兜底链接：catalog 空了、或用户想找历史版本时去这里 */
const GITHUB_RELEASES_URL = "https://github.com/liaojie1314/yuanchat/releases";

/** 已支持的客户端平台；目录尚无安装包也保留平台行。 */
const PLATFORMS = ["windows", "darwin", "linux", "android"] as const;

/** 拉取目录的四种状态：加载 / 就绪 / 空 / 出错 */
type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: CatalogEntry[] }
  | { kind: "empty" }
  | { kind: "error" };

/** 把字节数格式化成 78.0 MB 这样的短标签（与文件进度条同一口径） */
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 从 URL 里取文件名展示（取不出就原样给 url，不让链接无处落脚） */
function fileNameOf(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/");
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** 读 UAData；旧浏览器没有该 API，架构识别必须能回落到 UA。 */
function uaData() {
  return (
    navigator as Navigator & {
      userAgentData?: {
        platform?: string;
        getHighEntropyValues?: (
          hints: string[],
        ) => Promise<{ architecture?: string; bitness?: string }>;
      };
    }
  ).userAgentData;
}

interface Props {
  /** 关闭回调（遮罩点击 / 关闭按钮）；不传则只展示内容、不给关闭手段 */
  onClose?: () => void;
}

/** Web 客户端目录浮层，四态共用固定面板尺寸，内容过长时内部滚动。 */
export function DownloadPanel({ onClose }: Props = {}) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    windows: t("download.platform.windows"),
    darwin: t("download.platform.darwin"),
    linux: t("download.platform.linux"),
    android: t("download.platform.android"),
  };
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // 平台识别只在挂载时做一次：同一面板的生命周期内 UA 不会变
  const platform = useMemo(() => detectPlatform(navigator.userAgent, uaData()?.platform), []);
  const [architecture, setArchitecture] = useState<DetectedArchitecture>("unknown");

  useEffect(() => {
    const data = uaData();
    const ua = navigator.userAgent;
    if (!data?.getHighEntropyValues) {
      setArchitecture(detectArchitecture(ua));
      return;
    }
    let active = true;
    // 现代浏览器会把 ARM Windows 的 UA 伪装成 x64，须等真实架构后才推荐。
    void data
      .getHighEntropyValues(["architecture", "bitness"])
      .then((info) => {
        if (active) setArchitecture(detectArchitecture(ua, info));
      })
      .catch(() => {
        if (active) setArchitecture(detectArchitecture(ua));
      });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetchCatalog()
      .then((items) => setState(items.length > 0 ? { kind: "ready", items } : { kind: "empty" }))
      .catch((err) => {
        captureException(err, { context: "fetchCatalog" });
        setState({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = state.kind === "ready" ? state.items : [];
  const candidates = items.filter((item) => item.platform === platform);
  const recommended =
    candidates.find((item) => item.arch === architecture) ??
    (platform === "darwin" ? candidates.find((item) => item.arch === "universal") : undefined);
  const currentPlatform = PLATFORMS.find((p) => p === platform);
  const otherPlatforms = PLATFORMS.filter((p) => p !== currentPlatform);

  /** 同一下载行展示推荐包和其他包，推荐只用柔和边框标识，不做大型主按钮。 */
  const packageLink = (item: CatalogEntry, promoted = false) => (
    <a
      href={item.url}
      download
      data-testid={promoted ? "recommended" : undefined}
      className={cn(
        "text-on-surface focus-visible:outline-primary flex h-[56px] items-center gap-3 rounded-lg px-3 py-3 focus-visible:outline focus-visible:outline-2",
        promoted
          ? "border-primary/30 bg-primary-container/20 border"
          : "hover:bg-surface-container",
      )}
    >
      <span className="bg-surface-container-high text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
        <Download size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-label-lg block truncate font-medium">
          {labels[item.platform] ?? item.platform}{" "}
          <span className="text-on-surface-variant text-label-sm font-normal">{item.arch}</span>
        </span>
        <span className="text-label-sm text-on-surface-variant block truncate">
          {promoted ? `v${item.version}` : fileNameOf(item.url)}
          {item.size > 0 && <> · {t("download.sizeLabel", { size: humanSize(item.size) })}</>}
        </span>
      </span>
      <span className="text-primary text-label-md shrink-0 font-medium">{t("download.get")}</span>
    </a>
  );

  /** 同系统的所有架构归同组；未发布安装包的平台保留明确禁用项。 */
  const platformRows = (p: (typeof PLATFORMS)[number]) => {
    const available = items.filter((item) => item.platform === p);
    const ordered =
      recommended?.platform === p
        ? [recommended, ...available.filter((item) => item !== recommended)]
        : available;
    return ordered.length ? (
      ordered.map((item) => (
        <li key={`${item.platform}-${item.arch}`}>{packageLink(item, item === recommended)}</li>
      ))
    ) : (
      <li
        key={p}
        aria-disabled="true"
        className="text-on-surface-variant flex h-[56px] items-center gap-3 px-3 py-3"
      >
        <span className="bg-surface-container-high flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          <Download size={18} />
        </span>
        <span>
          <span className="text-label-lg block font-medium">{labels[p]}</span>
          <span className="text-label-sm block">{t("download.unavailable")}</span>
        </span>
      </li>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("download.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface shadow-elevation-2 mx-4 flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-lg p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-title-md text-on-surface font-semibold">{t("download.title")}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="text-on-surface-variant hover:bg-surface-container-high rounded-lg p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="h-[298px] min-h-0 overflow-y-auto">
          {state.kind === "error" ? (
            <div className="py-8 text-center">
              <p className="text-body-md text-on-surface-variant">{t("download.failed")}</p>
              <button
                type="button"
                onClick={load}
                className="border-outline-variant text-on-surface text-label-lg mt-4 rounded-lg border px-4 py-2"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <div data-testid={state.kind === "loading" ? "download-skeleton" : undefined}>
              {currentPlatform && (
                <section aria-label={t("download.currentPlatform")}>
                  <h3 className="text-label-md text-on-surface-variant mb-2 h-5 leading-5 font-medium">
                    {t("download.currentPlatform")}
                  </h3>
                  {state.kind === "loading" ? (
                    <div
                      aria-hidden
                      className="bg-surface-container-high h-[56px] animate-pulse rounded-lg"
                    />
                  ) : (
                    <ul className="grid gap-2">{platformRows(currentPlatform)}</ul>
                  )}
                </section>
              )}
              <section
                className={currentPlatform ? "mt-3" : undefined}
                aria-label={t("download.other")}
              >
                <h3 className="text-label-md text-on-surface-variant mb-2 h-5 leading-5 font-medium">
                  {t("download.other")}
                </h3>
                {state.kind === "loading" ? (
                  <div aria-hidden className="grid gap-2">
                    {otherPlatforms.map((p) => (
                      <div
                        key={p}
                        className="bg-surface-container-high h-[56px] animate-pulse rounded-lg"
                      />
                    ))}
                  </div>
                ) : (
                  <ul className="grid gap-2">{otherPlatforms.map(platformRows)}</ul>
                )}
              </section>
            </div>
          )}
        </div>
        <div className="text-label-sm mt-3 flex h-6 shrink-0 items-center justify-between gap-2">
          <span className="text-on-surface-variant min-w-0 truncate">
            {state.kind === "empty" && t("download.empty")}
          </span>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex shrink-0 items-center gap-1.5"
          >
            <Download size={14} />
            {t("download.githubFallback")}
          </a>
        </div>
      </div>
    </div>
  );
}
