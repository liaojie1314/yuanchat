/**
 * fileIcon — 文件扩展名 → 图标与配色映射
 *
 * @description
 * 文件气泡的类型徽标：不再用文字（PDF/ZIP…），按扩展名分类映射 lucide 图标 +
 * 品类色（红=pdf、蓝=文档、绿=表格、橙=演示、紫=压缩包、青=音频、粉=视频…），
 * 未识别扩展名回退通用 File 图标 + 灰色。
 */
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface FileKindStyle {
  Icon: LucideIcon;
  /** 徽标底色（Tailwind class，深浅主题下均可读） */
  bg: string;
}

const KIND_STYLES: Record<string, FileKindStyle> = {
  pdf: { Icon: FileText, bg: "bg-red-600" },
  doc: { Icon: FileText, bg: "bg-blue-600" },
  txt: { Icon: FileText, bg: "bg-slate-500" },
  sheet: { Icon: FileSpreadsheet, bg: "bg-green-600" },
  slide: { Icon: Presentation, bg: "bg-orange-500" },
  archive: { Icon: FileArchive, bg: "bg-violet-600" },
  audio: { Icon: FileMusic, bg: "bg-cyan-600" },
  video: { Icon: FileVideo, bg: "bg-pink-600" },
  image: { Icon: FileImage, bg: "bg-teal-600" },
  code: { Icon: FileCode, bg: "bg-indigo-600" },
  other: { Icon: File, bg: "bg-slate-500" },
};

/** 扩展名（大写/小写均可）→ 品类 key */
function kindOf(ext: string): keyof typeof KIND_STYLES {
  switch (ext.toLowerCase()) {
    case "pdf":
      return "pdf";
    case "doc":
    case "docx":
      return "doc";
    case "txt":
    case "md":
      return "txt";
    case "xls":
    case "xlsx":
    case "csv":
      return "sheet";
    case "ppt":
    case "pptx":
      return "slide";
    case "zip":
    case "rar":
    case "7z":
    case "gz":
    case "tar":
      return "archive";
    case "mp3":
    case "wav":
    case "webm":
    case "ogg":
    case "m4a":
      return "audio";
    case "mp4":
    case "mov":
    case "avi":
    case "mkv":
      return "video";
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
    case "svg":
      return "image";
    case "js":
    case "ts":
    case "tsx":
    case "go":
    case "py":
    case "java":
    case "json":
    case "html":
    case "css":
      return "code";
    default:
      return "other";
  }
}

/** 文件扩展名 → {Icon, bg}；未识别回退通用 File + 灰 */
export function fileIconOf(ext: string): FileKindStyle {
  return KIND_STYLES[kindOf(ext)];
}
