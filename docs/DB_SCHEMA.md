# 03 — 数据库设计（按 goose 迁移序）

> **前置阅读**：[ARCHITECTURE.md](./ARCHITECTURE.md)
>
> 本文按 `server/internal/database/migrations/` 的实际迁移序（001 → 015）重建，
> 与代码严格同步；旧文档中的 Elasticsearch / MinIO 章节已过时，不在此保留。

---

## 一、goose 迁移工作流

- **工具**：[pressly/goose](https://pressly.github.io/goose/) 嵌入式 SQL 迁移，迁移文件位于
  `server/internal/database/migrations/`，通过 `embed` 打进二进制，服务启动时自动执行 `up`。
- **文件命名**：`NNN_描述.sql`，内部用 `-- +goose Up` / `-- +goose Down` 注解划分升降级段落；
  需要多语句块（如含 `;` 的 DDL）用 `-- +goose StatementBegin/StatementEnd` 包裹。
- **幂等性**：基准迁移及多数语句使用 `IF NOT EXISTS` / `IF EXISTS`，可安全重跑。
- **新迁移流程**：
  1. 新建 `0NN_xxx.sql`，写 `Up`（建表/加列/建索引）与对应的 `Down`；
  2. 本地 `pnpm dev:server` 启动时自动应用，或单独用 `cmd/migrate` 执行；
  3. 验证 `goose status` 与业务读写正常后随代码一起提交；
  4. 生产部署由 `cmd/migrate` 在应用启动前单独执行迁移。
- **特殊用法**：
  - `CREATE INDEX CONCURRENTLY` 必须放在 `-- +goose NO TRANSACTION` 迁移中（见 003），
    避免长事务锁表；
  - 基准迁移（001）不提供有效 `Down` —— 生产环境不应 down 到空库；
  - 数据回填（如 015 的官方包 `is_public` 补齐）直接写在 `Up` 段内，与 DDL 同事务生效。

---

## 二、迁移明细（001 → 015）

### 001_baseline — 基准 Schema 快照

合并了最初的 `001_init.sql` 与 `002_contacts.sql`，是全库起点。建立扩展
`uuid-ossp`、`pg_trgm`，并创建核心表：

| 表                     | 用途      | 关键列 / 约束                                                                                                             |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `users`                | 用户      | `phone`/`email` 唯一、软删 `deleted_at`；昵称 `gin_trgm_ops` GIN 索引（模糊搜索）                                         |
| `conversations`        | 会话      | `type`（1 单聊 / 2 群聊 / 3 系统）、`last_seq` 游标；软删                                                                 |
| `conversation_members` | 会话成员  | `role`（0 成员 / 1 管理员 / 2 群主）、`last_read_seq`（已读回执）、`is_muted`（免打扰）；UNIQUE(conversation_id, user_id) |
| `messages`             | 消息      | `seq` 会话内递增、`content JSONB`、`status`（1 正常 / 2 撤回 / 3 删除）、软删；UNIQUE(conversation_id, seq)               |
| `message_status`       | 送达/已读 | UNIQUE(message_id, user_id)，`delivered_at` / `read_at`                                                                   |
| `contacts`             | 好友关系  | `status`（0 待确认 / 1 已添加 / 2 已拒绝 / 3 已删除）；软删；UNIQUE(user_id, contact_user_id)                             |
| `verification_codes`   | 验证码    | `target` + `expires_at` 索引                                                                                              |
| `friend_requests`      | 好友申请  | UNIQUE(requester_id, target_id)，`(target_id, status)` 索引                                                               |

所有软删表均带 `deleted_at`；部分索引（如 users 的 phone/email）都带 `deleted_at IS NULL` 条件。

### 002_v02_additions — v0.2 表情回应 / 拉黑 / @ 提及

- 新表 `message_reactions`：UNIQUE(message_id, user_id, emoji)，一人一消息一表情只有一条。
- 新表 `blocklists`：UNIQUE(user_id, target_id)，单聊发送拦截的依据。
- `conversation_members` 加 `mention_unread BOOLEAN`（@ 未读角标）。
- `messages` 补 `reply_to_id`（引用回复）、`mentions UUID[]`、`client_msg_id`（幂等 ID）。
- 修正旧 AutoMigrate 产生的索引：重建唯一索引 `idx_conversation_seq(conversation_id, seq)`。

### 003_message_search_index — 消息全文检索索引

`-- +goose NO TRANSACTION` + `CREATE INDEX CONCURRENTLY`（不锁表）：
`idx_messages_text_trgm` — 对 `content->>'text'` 建 `gin_trgm_ops` GIN 索引，
部分索引条件 `deleted_at IS NULL AND status = 1`，支撑 `GET /messages/search`。

### 004_a5_favorites — 收藏

新表 `favorites`：快照式收藏（冗余 `conv_name` / `sender_nickname` / `message_type` /
`content JSONB`，消息删除后收藏仍可展示）；UNIQUE(user_id, message_id)。

### 005_e2_admin — 管理后台

- `users` 加 `role SMALLINT`（0 普通用户，非 0 为管理员），配合 JWT `role` 声明做双重校验。
- 新表 `admin_action_logs`：审计日志（actor / action / target_type / target_id / detail JSONB），
  按操作人与操作类型分别建 `(…, created_at DESC)` 索引。

### 006_e3_moderation — 举报与内容审核

- `messages` 加 `flagged BOOLEAN`，部分索引 `(flagged, created_at DESC) WHERE flagged = TRUE`
  服务审核队列（敏感词命中只标记不阻塞发送）。
- 新表 `reports`：举报（`target_type` = message | user，`status` 0 待处理 / 1 已保留 / 2 已删除，
  `handled_by` / `handled_at`）。

### 007_d3_web_push — Web Push 订阅

新表 `push_subscriptions`：`endpoint` 唯一（同一浏览器重复订阅覆盖而非堆积），
存 `p256dh` / `auth` 密钥与 `user_agent`。

### 008_d4_e2ee — 端到端加密（X3DH + Double Ratchet）

| 表                      | 用途                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `e2ee_identities`       | 身份密钥 + signed prekey，每用户一行（PK 即 user_id），换设备/轮换时覆盖  |
| `e2ee_one_time_prekeys` | 一次性预密钥池，UNIQUE(user_id, key_id)；分发一个即删一个（前向保密关键） |
| `e2ee_key_backups`      | 密钥备份：客户端 PIN 派生密钥加密的 blob + KDF 盐，服务端只存不解         |

### 009_a6_conversation_settings — 会话置顶

`conversation_members` 加 `is_pinned BOOLEAN` + `pinned_at TIMESTAMPTZ`（按成员维度置顶）。

### 010_a7_chat_experience — 群公告 / 群昵称 / 清空聊天记录

- `conversation_members` 加 `cleared_before_seq BIGINT`（清空水位：历史查询按 seq 过滤）
  与 `alias VARCHAR(30)`（群内昵称）。
- `conversations` 加 `announcement TEXT` + `announcement_updated_at`（群公告）。

### 011_h1_stickers — 贴纸 / 收藏表情

| 表              | 用途                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sticker_packs` | 表情包（名称、封面、`is_official`、`sort`）                                                                                           |
| `stickers`      | 单张贴纸：`pack_id` / `owner_id` 二选一外键，`object_key`（MinIO 对象），`content_hash` 内容寻址去重 — UNIQUE(owner_id, content_hash) |

### 012_sticker_constraints — 贴纸归属互斥约束

把「`pack_id` 与 `owner_id` 互斥」的不变量从应用层下沉到数据库：
`chk_stickers_owner_xor_pack CHECK ((pack_id IS NULL) <> (owner_id IS NULL))`，
防止将来新增写入路径（如表情商城）产出两者同时非空/同时为空的脏数据。

### 013_object_acl_and_gc — 对象级读授权与 GC 索引

为「按对象 key 反查归属」补两条索引，是下载授权（`/files/download-url`）与对象回收
（`cmd/gc`）的共同基础：

- `idx_messages_content_key` — `messages((content->>'key'))` 表达式索引；撤回会把
  `content` 置 `'{}'`，行自然退出索引，实现「撤回即撤销访问」；
- `idx_stickers_object_key` — 贴纸按 key 反查本人收藏/表情包归属。

### 014_auth_token_version — 改密吊销旧令牌

`users` 加 `token_version INT DEFAULT 0`：签发 JWT 时写入 `tv` 声明，校验方比对库中值，
不一致即吊销。只在 token 刷新与 WS 建连处校验（REST 靠 15 分钟 access TTL 自然过期，
避免每个请求查库）。

### 015_h1b_sticker_market — 表情商城

- `sticker_packs` 加 `owner_id`（发布者，注销时 `SET NULL`）、`is_public`（商城可见）、
  `flagged`（敏感词标记，同 messages 范式）、`taken_down`（下架，已添加者保留）；
  并回填存量官方包 `is_public = TRUE`。
- 新表 `user_sticker_packs`：用户添加的表情包（我的列表 = 官方包 + 已添加包），
  UNIQUE(user_id, pack_id)，按 `sort` 排序。
- 商城列表索引 `idx_packs_public(is_public, taken_down, created_at DESC)`；
  审核队列部分索引 `idx_packs_flagged … WHERE flagged = TRUE`。

---

## 三、最终态关键表结构

> 仅列核心列与关系，完整 DDL 以 `server/internal/database/migrations/` 为准。

### 用户与关系

```
users            id, phone(uniq), email(uniq), password_hash, nickname, avatar_url,
                 bio, gender, birthday, status, role, token_version,
                 last_login_at, deleted_at
contacts         user_id → users, contact_user_id → users, remark, status, deleted_at
                 UNIQUE(user_id, contact_user_id)
friend_requests  requester_id, target_id, message, status   UNIQUE(requester_id, target_id)
blocklists       user_id, target_id                          UNIQUE(user_id, target_id)
```

### 会话与消息

```
conversations          id, type(1单聊/2群聊/3系统), name, avatar_url, announcement,
                       announcement_updated_at, last_message_id, last_seq, deleted_at
conversation_members   conversation_id, user_id, role(0/1/2), last_read_seq,
                       is_muted, is_pinned, pinned_at, mention_unread,
                       cleared_before_seq, alias   UNIQUE(conversation_id, user_id)
messages               conversation_id, sender_id, seq, message_type, content JSONB,
                       status(1/2/3), reply_to_id, mentions UUID[], client_msg_id,
                       flagged, deleted_at        UNIQUE(conversation_id, seq)
message_status         message_id, user_id, status, delivered_at, read_at
message_reactions      message_id, user_id, emoji  UNIQUE(message_id, user_id, emoji)
favorites              user_id, message_id, conversation_id, 快照字段, content JSONB
                       UNIQUE(user_id, message_id)
```

关键索引：`idx_messages_conversation(conversation_id, seq DESC)`（历史游标分页）、
`idx_messages_text_trgm`（全文检索）、`idx_messages_content_key`（对象反查/授权/GC）。

### 平台治理

```
push_subscriptions  user_id, endpoint(uniq), p256dh, auth, user_agent
reports             reporter_id, target_type(message|user), target_id, reason,
                    status(0待处理/1保留/2删除), handled_by, handled_at
admin_action_logs   actor_id, action, target_type, target_id, detail JSONB
```

### 端到端加密

```
e2ee_identities        user_id(PK), identity_dh_public_key, identity_sign_public_key,
                       signed_prekey_*（每用户一行，覆盖式轮换）
e2ee_one_time_prekeys  user_id, key_id, public_key   UNIQUE(user_id, key_id)（用即删）
e2ee_key_backups       user_id(PK), cipher_blob, salt, version（服务端零知识）
```

### 贴纸与商城

```
sticker_packs       id, name, cover_url, is_official, owner_id?, is_public,
                    flagged, taken_down, sort
stickers            pack_id? / owner_id?（CHECK 互斥）, object_key, width, height,
                    content_hash   UNIQUE(owner_id, content_hash)
user_sticker_packs  user_id, pack_id, sort   UNIQUE(user_id, pack_id)
```

---

> **下一步**：[CHAT_API.md](./CHAT_API.md) — 聊天 REST API 与 WebSocket 协议
