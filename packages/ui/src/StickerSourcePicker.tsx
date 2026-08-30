/**
 * StickerSourcePicker 组件 — 贴纸来源选择器（发布 / 编辑共用）
 *
 * @description
 * 两个来源入口：
 * - 从我的收藏多选（网格点选，选中项描边 + 角标对勾）
 * - 直传新图（复用 uploadAndCollectSticker：压缩 → 直传 → 收藏，
 *   成功后经 onUploaded 回调进入收藏网格并自动勾选）
 *
 * 纯受控组件：选中集合、上传状态都由父层持有，本组件只发事件。
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, ImagePlus } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";
import { showToast } from "@yuanchat/shared";
import type { StickerItem } from "@yuanchat/shared";
import { StickerThumb } from "./StickerThumb";
import { uploadAndCollectSticker } from "./stickerUpload";

export function StickerSourcePicker({
  stickers,
  selectedIds,
  excludedIds,
  onToggle,
  onUploaded,
  onUploadStart,
  onUploadEnd,
}: {
  /** 本人收藏贴纸（父层拉取后传入） */
  stickers: StickerItem[];
  /** 当前勾选的贴纸 id 集合 */
  selectedIds: string[];
  /** 已在包内的贴纸 id（编辑页防止重复加入，渲染为不可点选） */
  excludedIds?: string[];
  /** 勾选/取消勾选回调 */
  onToggle: (id: string) => void;
  /** 直传成功回调（参数为新收藏项；父层负责把它并入收藏网格并勾选） */
  onUploaded: (sticker: StickerItem) => void;
  /** 上传开始（父层据此禁用提交按钮） */
  onUploadStart: () => void;
  /** 上传结束（无论成败） */
  onUploadEnd: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  /** 逐张直传：一张失败即中止并提示（后续文件由用户重试，避免半批成功的歧义） */
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploadingRef.current) return;
    uploadingRef.current = true;
    onUploadStart();
    try {
      for (let i = 0; i < files.length; i++) {
        const created = await uploadAndCollectSticker(files[i]);
        onUploaded(created);
      }
    } catch (err) {
      console.error(err);
      showToast("error", t("sticker.market.uploadFailed"));
    } finally {
      uploadingRef.current = false;
      onUploadEnd();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div>
      {/* 直传新图入口 */}
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border-outline-variant text-on-surface hover:bg-surface-container-low inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
        >
          <ImagePlus size={16} />
          {t("sticker.market.uploadNew")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {/* 收藏网格（多选） */}
      {stickers.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant py-3">{t("sticker.emptyFavorites")}</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
          {stickers.map((st) => {
            const selected = selectedIds.indexOf(st.id) >= 0;
            const excluded = (excludedIds ?? []).indexOf(st.id) >= 0;
            return (
              <button
                key={st.id}
                type="button"
                disabled={excluded}
                aria-pressed={selected}
                aria-label={t("sticker.addToStickers")}
                onClick={() => onToggle(st.id)}
                className={cn(
                  "relative grid aspect-square place-items-center rounded-lg p-1 transition-colors",
                  excluded
                    ? "bg-surface-container-low opacity-40"
                    : selected
                      ? "ring-primary bg-surface-container-low ring-2"
                      : "hover:bg-surface-container-low",
                )}
              >
                <StickerThumb objectKey={st.object_key} />
                {selected && (
                  <span className="bg-primary text-on-primary absolute top-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full">
                    <Check size={11} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
