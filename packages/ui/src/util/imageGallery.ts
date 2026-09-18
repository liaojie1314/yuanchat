/**
 * buildGallery — 一批对象 key 换成大图查看器要的 URL 列表
 *
 * @description
 * {@link ImageLightbox} 只收签好的 URL，而九宫格 / 相册的每一格都是各自签名的。
 * 点开某一格时用这个把同一批 key 整体签出来交给查看器——`getDownloadUrl` 自带
 * 进程内缓存，已渲染出来的格子在这里几乎是零成本命中。
 *
 * 签不出来的条目直接剔除，并相应把起始下标往前挪，免得查看器停在空白页。
 *
 * @param keys - 同一批图片的对象 key，顺序即展示顺序
 * @param clicked - 用户点的是第几个（按 `keys` 的下标）
 * @returns 可直接喂给 ImageLightbox 的 `urls` 与校正后的 `index`
 */
import { getDownloadUrl } from "@yuanchat/shared";

export async function buildGallery(
  keys: string[],
  clicked: number,
): Promise<{ urls: string[]; index: number }> {
  const signed = await Promise.all(keys.map((k) => getDownloadUrl(k).catch(() => "")));
  const urls: string[] = [];
  let index = 0;
  signed.forEach((url, i) => {
    if (!url) return;
    if (i === clicked) index = urls.length;
    urls.push(url);
  });
  return { urls, index };
}
