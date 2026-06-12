export type { Conversation } from "./store/conversationStore";

/** 用户基础信息 */
export interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
  status: number;
  createdAt: string;
}

/** 消息类型 */
export type MessageType = "text" | "image" | "file" | "voice" | "video" | "system";

/** 消息体 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  seq: number;
  messageType: MessageType;
  content: string; // JSON string for structured content
  status: number;
  replyToId?: string | null;
  createdAt: string;
}

/** 消息发送请求 */
export interface SendMessageRequest {
  conversationId: string;
  messageType: MessageType;
  content: string;
  clientMsgId?: string;
}

/** API 统一响应 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  code: number;
  message: string;
  data: T[];
  total: number;
  page: number;
  size: number;
}
