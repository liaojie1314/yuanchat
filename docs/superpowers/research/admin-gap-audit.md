# 管理后台能力缺口调查（2026-08-30，供下一会话立项用）

> 调查方法：盘点 apps/admin 现有页面/端点 vs 产品侧全部用户能力（路由、组件、三端特有），
> 输出「产品侧有能力但管理端无可见性/干预手段」的缺口。本文件是调查原文存档，
> 立项时以 MASTER_PLAN 登记为准，本文件只作展开细节。

## admin 已覆盖（足够，避免误报）

用户封禁/解封+踢下线（admin.go:70-118）、会话解散（:129-173）、消息检索/删除（:184-221）、
敏感词消息审核队列（ModerationQueue.tsx:32-81，含转发与 WS 发送路径）、贴纸包审核+软下架
（admin.go:308-325）、举报处置（admin_service.go:158-198）、审计日志 + JWT/role 双校验
（router.go:311）。

## P0 — 内容安全/滥用面

- **P0-1 非文本消息零审核入口**：敏感词只查文本（message_service.go:222 只处理 MessageTypeText）；
  admin 审核页对图片/语音/文件/贴纸只渲染占位标签（MessageAudit.tsx:11-16,61-64），无预览。
  建议：admin 消息页做图片缩略/语音播放/文件下载预览（走独立 admin 对象读授权）。
- **P0-2 昵称/群名/群公告/bio 绕过敏感词**：UpdateProfile 无审核注入（user_service.go:281-309），
  群改名只校验长度（conversation_manage.go:98-101），群公告同理（conversation_experience.go:49-56）。
  建议：三处写入接 ModerationService 打标进队列 + admin 强制重置动作。
- **P0-3 头像/贴纸封面匿名公共读无治理**（file.go:31-42）：建议 admin 加「重置头像」动作，
  中期图片机审。
- **P0-4 举报 target=user 无处置闭环**：HandleReport delete 分支只处理消息与贴纸包
  （admin_service.go:168-175）；user 举报只有保留按钮。建议加「封禁用户」动作或深链用户页。

## P1 — 运营可见性

- **P1-1 贴纸包全量管理缺失**：后端 ListStickerPacks 支持 q+全量（admin.go:288-298）但 UI 恒带
  flagged=true（apps/admin/src/api.ts:144-148）；无 untakedown 端点、无官方标切换（只能 seed）。
- **P1-2 运行指标零可见**：hub 无连接数导出、Prometheus 只记 HTTP（prometheus.go:11-14）。
  建议 ws_connections/messages_total 等业务指标 + admin 概览页。
- **P1-3 对象存储无治理视图/无配额**：单用户可无限上传（file.go:106-114 只有类型与单文件上限）。
- **P1-4 OTP/好友请求量无视图**（好友请求无独立限流 router.go:276）。
- **P1-5 Web Push 订阅无视图**（订阅端点无限流 router.go:299）。

## P2 — 锦上添花

- P2-1 admin 删消息后收藏悬空引用（favorite.go:33-44）。
- P2-2 flagged 包处置前仍公开可见（sticker_service.go:509 只挡 taken_down），可评估 flag 即暂隐。
- P2-3 QR 登录/改密会话可见性（并入 P1-2 指标即可）。

## 明确不做（设计边界）

E2EE 零可见性（服务端只中转密文，e2ee.go:18-20，只建议密文量指标）；Desktop 更新器
（minisign 自校验，无服务端面）；Web PWA（静态资源 autoUpdate）；Android（复用 web 代码）；
黑名单/免打扰/群设置（用户自服务）。

## 建议批次切分

- **批次 A「审核体系补漏」**：P0-1 + P0-2 + P0-4（共享队列 UI 改造与 ModerationService 扩展；
  ROADMAP E3 续作，拆开做会重复改队列页）
- **批次 B「admin 运营仪表盘」**：P1-2 + P1-4 + P1-5 + P2-3（全只读，一个指标端点 + 概览页）
- **批次 C「贴纸包治理强化」**：P1-1（untakedown/官方标两小端点 + 全量列表页）+ P2-2 flag 暂隐
- **只登记**：P0-3 重置头像小动作；P1-3 存储统计；P2-1 级联清理；E2EE/PWA/更新器永久不做
- **关联**：ROADMAP G（朋友圈）是最大 UGC 面，立项时应把批次 A 审核管线作为前置依赖
  （ROADMAP.md:488-497）
