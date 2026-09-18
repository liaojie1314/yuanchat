/**
 * useObjectUrl — 对象 key → 预签名下载 URL
 *
 * @description
 * 换取对象存储的预签名 GET 地址（`getDownloadUrl` 自带进程内缓存，同一张图
 * 在列表里反复渲染不会重复签名）。签名失败保持 null，由调用方渲染占位——
 * 朋友圈网格与互动消息缩略图共用这一份。
 *
 * @param key - 对象 key；空值表示无图，直接停在 null
 * @returns 就绪前为 null 的下载地址
 * @remarks 切 key / 卸载后忽略迟到的回包，避免把上一格的图塞进这一格。
 */
import { useEffect, useState } from "react";
import { getDownloadUrl } from "@yuanchat/shared";

export function useObjectUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    getDownloadUrl(key)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        // 签名失败不阻断渲染：骨架底色留在原位，尺寸不变
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}
