/** 落盘目标目录：下载产物或应用数据。 */
export type SinkDir = "downloads" | "appdata";

/** 跨平台文件落盘能力，由各平台在启动时按需注入。 */
export interface FileSink {
  /**
   * 写入字节。
   * @returns 可展示给用户的相对文件名；Web 端无法获知保存位置，返回 `null`。
   */
  save(bytes: Uint8Array, fileName: string, mime: string, dir?: SinkDir): Promise<string | null>;
  /** 读回已落盘的字节，供发送重试使用。 */
  read?(fileName: string, dir: SinkDir): Promise<Uint8Array>;
  /** 删除已落盘的文件。 */
  remove?(fileName: string, dir: SinkDir): Promise<void>;
  /** 使用系统默认应用打开已落盘的文件。 */
  reveal?(path: string): Promise<void>;
}

/** Web 默认实现通过浏览器下载能力保存文件。 */
const webSink: FileSink = {
  async save(bytes, fileName, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = "noopener";
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return null;
  },
};

let sink: FileSink | null = null;

/** 注入当前平台的文件落盘实现。 */
export function setFileSink(implementation: FileSink): void {
  sink = implementation;
}

/** 获取当前文件落盘实现；未注入时返回 Web 默认实现。 */
export function getFileSink(): FileSink {
  return sink ?? webSink;
}

/** 测试辅助：还原未注入状态。 */
export function __resetFileSink(): void {
  sink = null;
}

/**
 * 返回未被占用的文件名；冲突时在最后一段扩展名前追加递增序号。
 *
 * @param name 期望的文件名
 * @param taken 判断文件名是否已被占用
 */
export function uniqueFileName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem} (${suffix})${extension}`;
    if (!taken(candidate)) return candidate;
  }
}
