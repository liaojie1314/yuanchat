/**
 * 元聊全局类型定义
 *
 * @description
 * 集中定义所有平台共享的 TypeScript 类型。
 * 后端 API 的请求/响应结构、消息体结构、分页格式等都在此定义。
 *
 * 类型命名约定：
 * - 数据实体：User、Message、Conversation（名词，对应数据库表）
 * - 请求体：XxxRequest（动词+Request，如 SendMessageRequest）
 * - 响应体：ApiResponse<T>、PaginatedResponse<T>（泛型包裹）
 */

// ========================
// 用户相关类型
// ========================

/** 用户基础信息（公开字段） */
export interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
  /** 账户状态：1=正常, 2=禁用, 3=注销 */
  status: 1 | 2 | 3;
  createdAt: string;
}

// ========================
// 消息相关类型
// ========================

/** 消息内容类型枚举 */
export type MessageType = "text" | "image" | "file" | "voice" | "video" | "system";

/** 消息实体 */
export interface Message {
  id: string;
  /** 所属会话 ID */
  conversationId: string;
  /** 发送者用户 ID */
  senderId: string;
  /** 会话内的递增序列号（用于多设备同步） */
  seq: number;
  /** 消息内容的 JSON 字符串（结构因 messageType 而异） */
  content: string;
  /** 消息状态：1=正常, 2=已撤回, 3=已删除 */
  status: 1 | 2 | 3;
  /** 引用/回复的消息 ID */
  replyToId?: string | null;
  createdAt: string;
}

/** 发送消息的请求体 */
export interface SendMessageRequest {
  conversationId: string;
  messageType: MessageType;
  /** 消息内容的 JSON 字符串 */
  content: string;
  /** 客户端生成的幂等 ID（防止重复发送） */
  clientMsgId?: string;
}

// ========================
// API 通用类型
// ========================

/** 后端 API 统一响应格式 */
export interface ApiResponse<T = unknown> {
  /** 业务状态码，0 表示成功 */
  code: number;
  /** 人类可读的消息 */
  message: string;
  /** 响应数据 */
  data: T;
}

/** 分页列表响应 */
export interface PaginatedResponse<T> {
  code: number;
  message: string;
  /** 当前页数据列表 */
  data: T[];
  /** 符合查询条件的总记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页条数 */
  size: number;
}
