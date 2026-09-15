/**
 * MessageImage 组件 — 图片气泡内的真实图渲染
 *
 * @description
 * 承载单条图片消息的展示，覆盖乐观发送与历史/接收两条路径：
 * - `localUrl`（发送方乐观预览）存在时直接渲染，上传确认后仍沿用，避免闪烁
 * - 否则据对象 `key` 经 getDownloadUrl 换取预签名 URL 再渲染，带进程内缓存
 * - 加载中显示等比占位骨架（防 CLS）；下载签名失败 / 图片加载失败显示点击重试
 *
 * 尺寸：按原始 width/height 等比缩进 {@link MAX_DISPLAY_EDGE}×{@link MAX_DISPLAY_EDGE}
 * 盒子内（不放大小图）；缺尺寸时回退固定占位框。显式设定盒子宽高防加载抖动。
 *
 * 兼容性：不用 CSS aspect-ratio（Chrome 88+），改用内联 width/height，Chrome 74 可用。
 *
 * @param image - 图片载荷（width/height 像素尺寸、可选 key / localUrl）
 * @param onOpen - 点击图片打开大图查看器的回调，参数为当前展示 URL
 */
import { useEffect, useRef, useState } from "react";
import { ImageIcon, ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDownloadUrl } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 气泡内图片展示盒的最长边（原始尺寸等比缩进此方框，不放大小图） */
const MAX_DISPLAY_EDGE = 280;
/** 尺寸缺失时的占位框（历史图正常都带宽高，仅极端兜底） */
const FALLBACK_BOX = { width: 200, height: 150 };
/** 失败占位框的最小尺寸：要同时放下图标与一行文案，小图按原尺寸会挤烂 */
const ERROR_BOX_MIN = { width: 132, height: 96 };
/** 懒加载预取缓冲：进入视口前此距离即开始 presign，滚动到时图基本就绪 */
const LAZY_ROOT_MARGIN = "300px";

/** 原始像素尺寸 → 展示盒尺寸：等比缩进 MAX_DISPLAY_EDGE 方框内，小图保持原尺寸 */
function displayBox(w: number, h: number): { width: number; height: number } {
  if (!w || !h) return FALLBACK_BOX;
  const scale = Math.min(1, MAX_DISPLAY_EDGE / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

type LoadState = "loading" | "loaded" | "error";

export function MessageImage({
  image,
  onOpen,
}: {
  image: { width: number; height: number; key?: string; localUrl?: string };
  onOpen?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const box = displayBox(image.width, image.height);

  // 乐观预览：localUrl 直接可用，无需签名下载
  const localUrl = image.localUrl;
  const key = image.key;
  // 换取的预签名下载 URL（localUrl 被撤销后 / 无 localUrl 时使用）
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  // 重取计数：点击重试自增，触发 effect 重新 getDownloadUrl
  const [reloadTick, setReloadTick] = useState(0);
  // 可见 <img> 当前绑定的地址：只前进不回退。ack 确认后 store 会撤销并清除 localUrl，
  // 但已解码的 blob 图仍在显示（撤销只影响后续取用）；待预签名 URL 预解码完成再切 displayUrl，
  // 避免出现空窗闪烁（原实现所惧）。
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(localUrl);
  const [state, setState] = useState<LoadState>(localUrl ? "loaded" : "loading");

  // 懒加载：进入视口（含 300px 预取缓冲）才发起 presign，
  // 大量历史图片会话不再批量签名。localUrl（乐观发送）无需等待。
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => !!localUrl || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (visible) return;
    const el = boxRef.current;
    if (!el) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    // 未进视口 / 有本地预览 / 无 key（异常）时不发下载请求；
    // localUrl 清除后此 effect 重跑发起签名
    if (!visible || localUrl || !key) return;
    let alive = true;
    getDownloadUrl(key)
      .then((url) => {
        if (alive) setFetchedUrl(url);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [visible, key, localUrl, reloadTick]);

  useEffect(() => {
    // 预签名 URL 就绪：无旧图时直接提交（初次加载走骨架）；有旧图则预解码后再切，杜绝闪烁
    if (!fetchedUrl || fetchedUrl === displayUrl) return;
    if (!displayUrl) {
      setDisplayUrl(fetchedUrl);
      return;
    }
    const pre = new Image();
    pre.onload = () => setDisplayUrl(fetchedUrl);
    pre.onerror = () => setState("error");
    pre.src = fetchedUrl;
  }, [fetchedUrl, displayUrl]);

  // 初次加载（无旧图）直接用签名 URL；有旧图（localUrl）时锁在 displayUrl 待预解码后再切
  const url = displayUrl ?? fetchedUrl ?? undefined;
  // 点击查看优先用预签名 URL：ack 后 localUrl 已撤销，避免大图查看器拿到失效 blob
  const openUrl = fetchedUrl ?? displayUrl;

  const retry = () => {
    setFetchedUrl(null);
    // 回落到 localUrl（若仍在）重挂骨架：无 localUrl 的 key 图则清空待重新签名
    setDisplayUrl(localUrl);
    setState("loading");
    setReloadTick((n) => n + 1);
  };

  // 下载签名失败 / 图片加载失败：点击整块重试
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={retry}
        aria-label={t("chat.image.loadError")}
        // 失败占位不跟随原图尺寸：小图（几十像素）放不下图标与文案，
        // 撑到最小尺寸再居中，文案限死一行，避免逐字换行的破碎版式
        style={{
          width: Math.max(box.width, ERROR_BOX_MIN.width),
          height: Math.max(box.height, ERROR_BOX_MIN.height),
        }}
        className="bg-surface-container-high text-on-surface-variant flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2 transition-opacity hover:opacity-80"
      >
        <ImageOff size={26} strokeWidth={1.25} />
        {/* 占位框只有 132px 宽，放不下整句提示，显示短文案（完整提示在 aria-label）。
            w-full 是截断生效的前提：竖排 flex 下 align-items:center 让文案按内容宽度撑开，
            单靠 truncate 只会横向溢出占位框（文案跑到气泡外面） */}
        <span className="text-label-sm w-full truncate text-center">
          {t("chat.image.loadErrorShort")}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={boxRef}
      style={box}
      className="bg-surface-container-high relative overflow-hidden rounded-lg"
    >
      {/* 加载占位骨架：与图同尺寸，防加载完成时的布局跳动 */}
      {state === "loading" && (
        <div
          className="text-on-surface-variant absolute inset-0 flex animate-pulse items-center justify-center"
          aria-hidden
        >
          <ImageIcon size={32} strokeWidth={1.25} />
        </div>
      )}
      {url && (
        <img
          src={url}
          alt={t("chat.image.alt")}
          title={t("chat.image.open")}
          width={box.width}
          height={box.height}
          onClick={() => openUrl && onOpen?.(openUrl)}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={cn(
            "block h-full w-full cursor-zoom-in object-cover transition-opacity duration-150",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
