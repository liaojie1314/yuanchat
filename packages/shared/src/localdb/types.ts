/**
 * 本地消息库的行类型定义。
 *
 * 会话行刻意镜像既有 `ConversationDTO` 的字段形状（而不是另造一套），
 * 否则每次 DTO 加字段都要在两处同步，必然漂移。
 */

/** outbox 条目的状态机取值 */
export type OutboxStatus = "pending" | "sending" | "failed" | "expired";

/** 会话列表投影行：DTO 快照 + 两个本地水位 */
export interface LocalConversationRow {
  /** 会话 id，即 keyPath */
  id: string;
  /** 服务端 ConversationDTO 原样快照（不解构，避免字段漂移） */
  dto: unknown;
  /**
   * 已**连续**确认到的 seq 水位。语义不是「见过的最大 seq」——
   * 两者混淆会导致空洞被永久跳过，见 advanceWatermark 的注释。
   */
  maxSeq: number;
  /** 清空聊天记录的水位，本地据此删除 seq <= 该值的消息 */
  clearedBeforeSeq: number;
  /** 排序用时间戳（毫秒），对应 by_updated 索引 */
  updatedAt: number;
}

/** 已确认消息行（必有 seq；待发消息在 outbox 而非此处） */
export interface LocalMessageRow {
  /** 服务端 message_id，即 keyPath */
  id: string;
  conversationId: string;
  /** 服务端分配的会话内序号，与 conversationId 组成 by_conv_seq 索引 */
  seq: number;
  /** 服务端 MessageDTO 原样快照 */
  dto: unknown;
  /**
   * 该消息引用的对象存储 key 列表（图片 key / 视频 thumb_key / 语音 key）。
   *
   * 必须在消息行上记着：`message.recalled` 帧只带 message_id 不带 key，
   * 删行时若不知道 key 就无从删除对应 blob，会留下永久孤儿（既占配额，
   * 又能被后续渲染命中，等于撤回没生效）。
   */
  mediaKeys: string[];
}

/** 待发队列行 */
export interface OutboxRow {
  /** 客户端生成的幂等 id，即 keyPath；服务端据此去重 */
  clientMsgId: string;
  conversationId: string;
  /** 原始 message.send 载荷，补发时原样重发（含 client_msg_id） */
  payload: unknown;
  /** 入队时间（毫秒），对应 by_created 索引，补发按它串行 */
  createdAt: number;
  status: OutboxStatus;
  /** 已尝试次数，仅用于诊断与退避，不作为过期判据 */
  attempts: number;
}

/** 媒体缓存行 */
export interface MediaRow {
  /** 对象存储 key，即 keyPath */
  objectKey: string;
  /**
   * 原始字节。**刻意存 ArrayBuffer 而不是 Blob**：部分 WebView 对 Blob 的
   * structured clone 会失败，ArrayBuffer 的支持面广得多。读时重建 Blob。
   */
  buf: ArrayBuffer;
  mimeType: string;
  bytes: number;
  /** 最后访问时间（毫秒），对应 by_access 索引，LRU 淘汰按它升序删 */
  lastAccessAt: number;
}
