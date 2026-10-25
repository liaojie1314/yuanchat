/**
 * DownloadPanel — Web 端客户端下载面板（侧栏沉底入口 / 手机设置项打开的浮层）。
 *
 * @description
 * 数据源是 /updates/catalog（app_releases 表），不硬编码 GitHub Releases ——
 * 否则同一份版本信息两处维护，迟早漂。表里没有 published 版本时走空态
 * 并给 GitHub 兜底链接。
 *
 * 推荐逻辑：detectPlatform 命中的平台放大按钮；其余平台默认折叠
 * （认不出平台、或推荐包未发布时不设推荐区，直接全部展开 —— 收着让用户
 * 找不到就尴尬了）。下载按钮是 `<a href download>` —— 走浏览器原生下载，
 * 不走应用内下载器：web 端装包本来就该交给浏览器。
 *
 * 加载态是**固定高度骨架屏**而非 spinner：容器高度钉死，数据到达时面板不跳（零 CLS）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { captureException, fetchCatalog, type CatalogEntry } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { detectPlatform } from "./detectPlatform";

/** GitHub Releases 兜底链接：catalog 空了、或用户想找历史版本时去这里 */
const GITHUB_RELEASES_URL = "https://github.com/liaojie1314/yuanchat/releases";

/** 平台 → 展示名（专有名词不进 i18n，各语言长得一样） */
const PLATFORM_LABEL: Record<string, string> = {
  windows: "Windows",
  darwin: "macOS",
  linux: "Linux",
  android: "Android",
};

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

/** 读 userAgentData.platform —— TS 的 DOM lib 尚未收录该 API，须窄化；旧 WebView 返回 undefined */
function uaDataPlatform(): string | undefined {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform;
}

interface Props {
  /** 关闭回调（遮罩点击 / 关闭按钮）；不传则只展示内容、不给关闭手段 */
  onClose?: () => void;
}

export function DownloadPanel({ onClose }: Props = {}) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [otherOpen, setOtherOpen] = useState(false);

  // 平台识别只在挂载时做一次：同一面板的生命周期内 UA 不会变
  const platform = useMemo(() => detectPlatform(navigator.userAgent, uaDataPlatform()), []);

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
  const recommended =
    platform !== "unknown" ? items.find((i) => i.platform === platform) : undefined;
  const expandAll = platform === "unknown" || !recommended;
  const others = recommended ? items.filter((i) => i !== recommended) : items;

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
      <div className="bg-surface shadow-elevation-2 mx-4 max-h-[80vh] w-full max-w-[420px] overflow-y-auto rounded-lg p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-title-md text-on-surface font-semibold">{t("download.title")}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("search.close")}
              className="text-on-surface-variant hover:bg-surface-container-high rounded-lg p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {state.kind === "loading" && (
          /* 固定高度骨架屏：容器高度钉死，数据到达时面板不跳 */
          <div data-testid="download-skeleton" className="h-64" aria-hidden>
            <div className="bg-surface-container-high h-24 animate-pulse rounded-lg" />
            <div className="bg-surface-container-high mt-3 h-10 animate-pulse rounded-lg" />
            <div className="bg-surface-container-high mt-3 h-10 w-2/3 animate-pulse rounded-lg" />
          </div>
        )}

        {state.kind === "error" && (
          <div className="py-8 text-center">
            <p className="text-body-md text-on-surface-variant">{t("download.failed")}</p>
            <button
              type="button"
              onClick={load}
              className="border-outline-variant text-on-surface hover:bg-surface-container text-label-lg mt-4 rounded-lg border px-4 py-2 font-medium"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {state.kind === "empty" && (
          <div className="py-8 text-center">
            <p className="text-body-md text-on-surface-variant">{t("download.empty")}</p>
            <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-label-lg mt-4 inline-flex items-center gap-1.5 font-medium"
            >
              <Download size={16} />
              {t("download.githubFallback")}
            </a>
          </div>
        )}

        {state.kind === "ready" && (
          <div>
            {/* 推荐区：当前系统命中且该包已发布时才出现，大按钮给足点击面积 */}
            {recommended && (
              <section aria-label={t("download.recommended")}>
                <p className="text-label-md text-on-surface-variant mb-2">
                  {t("download.recommended")}
                </p>
                <a
                  href={recommended.url}
                  download
                  data-testid="recommended"
                  className="bg-primary text-primary-on shadow-elevation-1 flex flex-col items-center gap-1 rounded-lg px-4 py-5 text-center transition-all hover:opacity-90"
                >
                  <Download size={24} />
                  <span className="text-title-md font-semibold">
                    {PLATFORM_LABEL[recommended.platform] ?? recommended.platform}
                  </span>
                  <span className="text-label-md">
                    v{recommended.version} ·{" "}
                    {t("download.sizeLabel", { size: humanSize(recommended.size) })}
                  </span>
                </a>
              </section>
            )}

            {/* 其余平台：默认折叠；推荐区缺席时直接全量展开 */}
            {others.length > 0 && (
              <section className="mt-4" aria-label={t("download.other")}>
                {!expandAll ? (
                  <button
                    type="button"
                    onClick={() => setOtherOpen((v) => !v)}
                    aria-expanded={otherOpen}
                    className="text-on-surface hover:bg-surface-container text-label-lg flex w-full items-center justify-between rounded-lg px-2 py-2 font-medium"
                  >
                    {t("download.other")}
                    <ChevronDown
                      size={16}
                      className={cn("transition-transform", otherOpen && "rotate-180")}
                    />
                  </button>
                ) : (
                  <p className="text-label-md text-on-surface-variant mb-2">
                    {t("download.other")}
                  </p>
                )}

                {(expandAll || otherOpen) && (
                  <ul className="mt-1">
                    {others.map((item) => (
                      <li key={`${item.platform}-${item.arch}`}>
                        <a
                          href={item.url}
                          download
                          className="text-on-surface hover:bg-surface-container text-label-lg flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors"
                        >
                          <span className="min-w-0 truncate">
                            {fileNameOf(item.url)}
                            <span className="text-on-surface-variant">
                              {" "}
                              · v{item.version} ·{" "}
                              {t("download.sizeLabel", { size: humanSize(item.size) })}
                            </span>
                          </span>
                          <Download size={16} className="shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
