/**
 * StickerPublishView 页面 — 发布表情包
 *
 * @description
 * 路由 `/stickers/publish` 的实现（两端 app 各自包一层 page 壳）：
 * 1. 命名（≤64 字，去首尾空白后非空）
 * 2. 选贴纸，两个来源：
 *    - 我的收藏多选（StickerSourcePicker）
 *    - 直传新图：上传后立即成为一条收藏项并自动勾选（共用一条 collection 通道）
 * 3. 选封面：默认取第一张勾选贴纸，点选其他勾选项可切换；提交时以该贴纸为源
 *    复制一份到 sticker-covers/ 公共读类别（封面单独计费无——一次普通上传）
 * 4. 提交发布：成功跳转新包详情；达每用户 20 个上限时服务端回 400 + 业务码
 *    4003（按 code 识别）转专属文案
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStickerBack } from "./useStickerBack";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check } from "lucide-react";
import {
  ApiError,
  captureException,
  listMyStickers,
  publishStickerPack,
  showToast,
} from "@yuanchat/shared";
import type { PublishPackInput, StickerItem, StickerSourceInput } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { StickerThumb } from "./StickerThumb";
import { StickerSourcePicker } from "./StickerSourcePicker";
import { uploadStickerCover } from "./stickerUpload";

/** 包名最大长度（与服务端 VARCHAR(64) 对齐） */
const NAME_MAX = 64;

/**
 * 识别「每用户发布数达上限」：服务端映射为 400 + 业务码 4003（同 4001/4002
 * 上传错误惯例）。按 code 而非 message 判断，避免服务端改文案即失配。
 */
function isPublishLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 4003;
}

export function StickerPublishView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 系统返回键与页面内返回箭头同语义，不落「非根页面回聊天页」的兜底
  useStickerBack("/stickers");
  const location = useLocation();

  const [name, setName] = useState("");
  const [myStickers, setMyStickers] = useState<StickerItem[]>([]);
  const [favoritesState, setFavoritesState] = useState<"loading" | "done" | "error">("loading");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 封面源贴纸：默认第一张勾选项；不勾选任何贴纸时无封面
  const [coverStickerId, setCoverStickerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 表单校验错误（提交时触发，就地显示）
  const [formError, setFormError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const loadFavorites = useCallback(async () => {
    setFavoritesState("loading");
    try {
      const list = await listMyStickers();
      setMyStickers(list);
      setFavoritesState("done");
    } catch (err) {
      captureException(err, { context: "StickerPublishView.loadFavorites" });
      setFavoritesState("error");
    }
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites, retryTick]);

  /** 返回：有历史栈时后退一格，深链直达时回商城列表 */
  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/stickers", { replace: true });
  };

  const toggle = (id: string) => {
    setFormError(null);
    setSelectedIds((prev) => {
      const next = prev.indexOf(id) >= 0 ? prev.filter((x) => x !== id) : prev.concat([id]);
      return next;
    });
  };

  // 直传成功：并入收藏网格头部并自动勾选（用户刚上传，大概率就是要发它）
  const handleUploaded = (sticker: StickerItem) => {
    setMyStickers((prev) => [sticker].concat(prev));
    setSelectedIds((prev) => (prev.indexOf(sticker.id) >= 0 ? prev : prev.concat([sticker.id])));
  };

  // 封面默认跟随第一张勾选；被取消勾选时回退
  useEffect(() => {
    if (selectedIds.length === 0) {
      if (coverStickerId !== null) setCoverStickerId(null);
      return;
    }
    if (!coverStickerId || selectedIds.indexOf(coverStickerId) < 0) {
      setCoverStickerId(selectedIds[0]);
    }
  }, [selectedIds, coverStickerId]);

  const selectedStickers = useMemo(() => {
    const byId = new Map(myStickers.map((s) => [s.id, s] as const));
    const picked: StickerItem[] = [];
    for (const id of selectedIds) {
      const st = byId.get(id);
      if (st) picked.push(st);
    }
    return picked;
  }, [myStickers, selectedIds]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError(t("sticker.market.nameRequired"));
      return;
    }
    if (selectedIds.length === 0) {
      setFormError(t("sticker.market.pickRequired"));
      return;
    }
    if (submitting || uploading) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const sources: StickerSourceInput[] = selectedIds.map((id) => ({
        source: "collection" as const,
        sticker_id: id,
      }));
      const input: PublishPackInput = { name: trimmed, sticker_sources: sources };
      // 封面：以勾选贴纸为源复制到 sticker-covers/；上传失败不阻塞发布（封面可后补）
      if (coverStickerId) {
        const src = selectedStickers.find((s) => s.id === coverStickerId);
        if (src) {
          try {
            const cover = await uploadStickerCover(src.object_key, src.width, src.height);
            input.cover_object_key = cover.objectKey;
            input.cover_width = cover.width;
            input.cover_height = cover.height;
          } catch (err) {
            captureException(err, { context: "StickerPublishView.uploadCover" });
          }
        }
      }
      const detail = await publishStickerPack(input);
      showToast("info", t("sticker.market.publishSuccess"));
      navigate("/stickers/" + detail.pack.id, { replace: true });
    } catch (err) {
      captureException(err, { context: "StickerPublishView.submit" });
      showToast(
        "error",
        isPublishLimitError(err)
          ? t("sticker.market.publishLimitExceeded")
          : t("sticker.market.publishFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 页头：返回 + 标题 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("sticker.market.back")}
          className="text-on-surface-variant hover:bg-surface-container inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-title-md text-on-surface font-semibold">
          {t("sticker.market.publish")}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-4">
          {/* 命名 */}
          <label
            htmlFor="sticker-pack-name"
            className="text-label-lg text-on-surface-variant mb-1 block"
          >
            {t("sticker.market.nameLabel")}
          </label>
          <input
            id="sticker-pack-name"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
            placeholder={t("sticker.market.namePlaceholder")}
            className="border-outline-variant bg-surface-container-low text-on-surface focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
          />

          {/* 选贴纸 */}
          <h2 className="text-title-sm text-on-surface mt-5 mb-2 font-medium">
            {t("sticker.market.pickStickers")}
          </h2>
          {favoritesState === "error" ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-body-sm text-on-surface-variant">{t("sticker.listFailed")}</p>
              <button
                type="button"
                onClick={() => setRetryTick((n) => n + 1)}
                className="text-primary text-sm"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <StickerSourcePicker
              stickers={myStickers}
              selectedIds={selectedIds}
              onToggle={toggle}
              onUploaded={handleUploaded}
              onUploadStart={() => setUploading(true)}
              onUploadEnd={() => setUploading(false)}
            />
          )}

          {/* 选封面（勾选后可见） */}
          {selectedStickers.length > 0 && (
            <>
              <h2 className="text-title-sm text-on-surface mt-5 mb-1 font-medium">
                {t("sticker.market.cover")}
              </h2>
              <p className="text-body-sm text-on-surface-variant mb-2">
                {t("sticker.market.coverHint")}
              </p>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                {selectedStickers.map((st) => {
                  const isCover = coverStickerId === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      aria-pressed={isCover}
                      aria-label={t("sticker.market.setAsCover")}
                      onClick={() => setCoverStickerId(st.id)}
                      className={cn(
                        "relative grid aspect-square place-items-center rounded-lg p-1 transition-colors",
                        isCover
                          ? "ring-primary bg-surface-container-low ring-2"
                          : "hover:bg-surface-container-low",
                      )}
                    >
                      <StickerThumb objectKey={st.object_key} />
                      {isCover && (
                        <span className="bg-primary text-on-primary text-label-sm absolute top-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* 校验错误就地显示 */}
          {formError && <p className="text-error text-body-sm mt-3">{formError}</p>}

          {/* 提交 */}
          <div className="mt-5 pb-4">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || uploading}
              className="bg-primary text-on-primary text-label-lg w-full rounded-lg py-2.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("sticker.market.submitPublish")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
