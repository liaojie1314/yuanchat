# H1b — 表情商城 + 自主发布 设计文档

> 立项：2026-08-09。H1（表情收藏 + 官方表情包）plan 已定稿（`2026-08-09-h1-stickers.md`），
> 本文档是其后续批次的**设计文档**，非 TDD 实施计划——执行前需用
> `superpowers:writing-plans` 展开为 task/step 级 plan。
>
> **依赖**：H1 必须先完成合并（本文档全部建立在 H1 的 `sticker_packs`/`stickers`
> 两表、`MessageTypeSticker=8`、EmojiPicker 收藏/官方 tab 之上）。

> ⚠️ **本文档不是真源**。范围与待实现内容的唯一依据是 `docs/MASTER_PLAN.md`。
> 本文档只是 H1b 的设计细节展开，执行前必须先用 `superpowers:writing-plans`
> 展开为 task/step 级 TDD 计划，并以 MASTER_PLAN 的范围为准复核。
>
> **基线**：`dev`（不再是 `b84a0b2`）。H1 主体、H1 审计修复批、对象级 ACL 与 GC
> 均已合入 dev，下文「H1 将提供的接口面」已成为既有现状。
>
> **迁移号：015**。原文写的 012 已被 `012_sticker_constraints.sql` 占用，
> 013 是对象 ACL/GC，014 属批次 A8（auth 补全）。
>
> 🔴 **执行 H1b 前必须先修的前置缺陷（不可跳过）**：
> `internal/repository/object_acl_repo.go:80` 的 `ReferencedKeys` 只从
> `messages.content->>'key'`、`stickers.object_key`、`users/conversations.avatar_url`
> 三处收集在用对象，**没有收集 `sticker_packs.cover_url`**。
> 也就是说 `cmd/gc -delete` 会把贴纸包封面判为孤儿删掉。
> 注意这个风险**现在就已存在**（官方包封面已入库），不是 H1b 才引入的。
> 修法：在 `ReferencedKeys` 里补一段对 `sticker_packs.cover_url` 的收集；
> `cover_url` 与 `avatar_url` 一样存的是**完整 URL**，必须用同样的
> `LIKE '%' || k` 后缀匹配，不能用等值 `IN`。

## 目标

1. **表情商城**：浏览全站公开表情包（官方 + 用户发布），免费「添加」到我的表情包列表，添加后在 EmojiPicker 中可用。
2. **自主发布**：用户把自己收藏的贴纸打包成新表情包、命名、直接公开发布。

**明确不做**（已与用户确认，2026-08-09 二次确认）：支付/定价/订单/退款——包括数据模型层面的 `price` 占位字段，**不预留**（→ H1c 候选，需独立立项时统一设计定价相关迁移，避免猜错字段形状导致 H1c 返工）；人工审核队列/上架审批流程（复用现有敏感词打标 + 举报治理）。

## 已定决策

| 编号  | 决策                   | 选择                                                                                                                                                                           | 理由                                                                                                                                         |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| H1b-a | 包详情页导航           | **URL 路由**（`/stickers` + `/stickers/:packId`）                                                                                                                              | 表情包需要可分享链接。代价：项目首例 URL 驱动的列表→详情页对（现有 ContactsScreen 等全是 state 切换），返回按钮/深链行为无先例可抄，需自定义 |
| H1b-b | 发布者注销后其发布的包 | **包保留，`owner_id` 置空**（显示为「已注销用户」）                                                                                                                            | 已添加该包的用户不应因发布者注销而丢失。需把外键从仓库惯例的 `ON DELETE CASCADE` 改为 `ON DELETE SET NULL`                                   |
| H1b-c | 包名敏感词             | **异步打标**（`flagged` 字段 + admin 队列）                                                                                                                                    | 与现有 `messages.flagged` 范式完全一致，零新概念。代价：违规包在被处理前全站可见                                                             |
| H1b-d | 贴纸图片审核           | 不审核（沿用 H1 决策）                                                                                                                                                         | 与图片消息现状一致                                                                                                                           |
| H1b-e | 贴纸多包归属           | **复制一份进新包**（新 `stickers` 行，`pack_id` 指向新包，`object_key` 可复用同一 MinIO 对象）                                                                                 | 发布后原收藏不受影响，用户体验上"复制"比"移动"直觉；对象存储零额外成本（多行指向同一 key）                                                   |
| H1b-f | 发布贴纸来源           | **收藏 + 直传均支持**                                                                                                                                                          | 发布流程一步到位，不强制先收藏再发布；直传复用 H1 已有的图片上传通道（`category=images`），非新增基础设施                                    |
| H1b-g | 发布包可否编辑         | **允许**（改名/加贴纸/删贴纸/换封面）                                                                                                                                          | `user_sticker_packs` 是关系表非快照（H1b-b 已定），编辑天然对已添加者实时生效，无额外一致性成本                                              |
| H1b-h | 移动端商城入口         | **收藏页顶部按钮 + EmojiPicker「官方」tab 底部链接**，底栏维持 4 项不变                                                                                                        | 商城低频，不挤占高频导航；桌面/平板左侧栏正常加第 5 项                                                                                       |
| H1b-i | 商城排序               | **发布时间倒序**（`created_at DESC`），游标分页同 favorites 惯例（`before=<RFC3339>`，不做 id tie-break——timestamptz 精度下实际冲突概率可忽略，与 favorites 现有精度承诺一致） | MVP 不引入热度指标（无浏览/添加计数基础设施），排序简单可预测；未来要按热度排序时再加计数字段和 offset 分页                                  |
| H1b-j | 封面存储               | **公共读**，新增 `sticker-covers/` 类别复用 avatars 匿名读策略模式                                                                                                             | 封面在列表页高频重复渲染，预签名会导致 N 包 = N 次签名请求；仓库已有 avatars 公共读先例，扩展成本低（策略 JSON 加一个 Resource）             |
| H1b-k | 每用户发布包数量上限   | **20**（硬编码常量，非配置项）                                                                                                                                                 | 防止单用户刷包污染商城列表；20 是防滥用的保守起点，非精算值，后续可按实际情况调整为配置项                                                    |
| H1b-k | 发布数量上限           | **20 个/用户**                                                                                                                                                                 | 纯运营防滥用护栏，无审核队列时防止刷屏；后续可调整为配置项                                                                                   |

## 现状基座（基线 dev）

### H1 已提供的接口面（本文档的直接依赖）

- 迁移 **011**（H1）、**012**（贴纸约束）、**013**（对象 ACL/GC）已落地；本批次是 **015**
- `sticker_packs(id, name VARCHAR(64), cover_url VARCHAR(500), is_official BOOLEAN DEFAULT FALSE, sort INTEGER DEFAULT 0, created_at)` — **无 `owner_id`、无 `is_public`**，本批次必须补
- `stickers(id, pack_id → sticker_packs ON DELETE CASCADE, owner_id → users ON DELETE CASCADE, object_key, width, height, content_hash, created_at, UNIQUE(owner_id, content_hash))`
- Service：`Add(ctx, userID, objectKey, width, height, contentHash)` / `Remove(ctx, userID, id)` / `ListMine(ctx, userID)` / `ListPacks(ctx)`；错误 `ErrInvalidObjectKey` / `ErrInvalidContentHash`
- 端点：`GET /stickers/mine`、`POST /stickers`、`DELETE /stickers/:id`、`GET /sticker-packs`（**均不分页**）
- 前端：`packages/shared/src/api/stickers.ts`（`listMyStickers()`/`listStickerPacks()` 解包后返数组）；EmojiPicker 的「收藏」「官方」两个 tab

### 关键现状约束（影响设计的硬事实）

| 领域          | 现状                                                                                                                                         | 对 H1b 的影响                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 导航          | `packages/ui/src/MainLayout.tsx:43-48` 单一 `NAV_ITEMS` 数组，桌面/移动共用；移动端底栏 4 项 `flex-1` 均分                                   | 加第 5 项会把每项压到 20% 宽——**移动端入口位置需要设计权衡**（见「导航方案」）                                           |
| 路由          | `apps/web/src/App.tsx:53-59` 与 `apps/desktop/src/App.tsx:105-111` **逐行同构**，页面组件是 4 行壳（实现全在 `packages/ui`）                 | 商城页实现放 `packages/ui`，两端各加 1 个 4 行 page 壳 + 1 行 Route                                                      |
| 高亮          | `MainLayout.tsx:88-89` `isActive` 用 `pathname.startsWith(to)`                                                                               | `/stickers/:packId` 会自动保持父项高亮，无需改动                                                                         |
| 列表范式      | `FavoritesView.tsx` 游标分页 + 手动「加载更多」按钮；**无骨架屏**（居中 spinner）、**无页面级 error 重试 UI**（仅 toast）                    | 商城列表照此范式；若要骨架屏是新增（可选，非阻塞）                                                                       |
| 详情范式      | `ContactsScreen.tsx:35-39` state 联合类型切换；返回按钮靠 `onBack` 是否传入决定渲染                                                          | H1b-a 选了 URL 路由——**无先例**，需自定义返回行为                                                                        |
| 举报          | `reports` 表已有 `target_type VARCHAR(32)`，DB 层**无 CHECK 约束**；`handler/report.go:24` binding `oneof=message user` 是硬编码白名单       | 加 `sticker_pack` **无需迁移**，改 3 处 Go：binding oneof、`model/report.go:33-36` 常量、`admin_service.go:165` 处置分支 |
| 举报处置      | `admin_service.go:165` `if deleteTarget && report.TargetType == model.ReportTargetMessage` — **user 类举报选 delete 什么都不删**（既有缺口） | 表情包要能真下架，必须加 `else if TargetType == "sticker_pack"` 分支                                                     |
| admin 举报 UI | `apps/admin/src/pages/ModerationQueue.tsx:169` `{r.target_type === "message" && <button deleteMsg>}`                                         | 同样需扩条件 + 文案 key                                                                                                  |
| 敏感词        | `ModerationService` 无状态无 DB 依赖，可任意处调用；但 `router.go:124` 是现场 `New` 直接塞给 msgSvc，**非共享单例**                          | 包名审核需把实例提到局部变量共享注入两处                                                                                 |
| 对象存储      | `minio.go:70-86` 匿名读策略**硬编码单条** `arn:aws:s3:::%s/avatars/*`，`SetBucketPolicy` 整桶覆盖                                            | 封面若要公开读，在这个 JSON 的 Resource 数组加一项；否则封面走预签名（列表页 N 包 = N 次签名）                           |
| 上传类别      | `file.go:28` 正则 `^(images\|avatars\|files)/...`、`:155` `resolveCategory` 白名单、前端 `files.ts:46` 联合类型 `"images" \| "avatars"`      | 新增 `sticker-covers` 类别要改这 3 处                                                                                    |
| 分页          | favorites 用**游标**（`created_at`）；admin 侧用 **offset**（`Paginated` 带 total）                                                          | `sticker_packs.sort` 非唯一——**游标分页在非唯一排序键上会漏/重**，商城排序需谨慎（见「分页决策」）                       |
| 幂等          | `favorite_repo.go:22-27` `Where(...).FirstOrCreate()` + UNIQUE 约束                                                                          | 「添加表情包」直接抄这个模式                                                                                             |
| 越权防护      | `favorite_repo.go:30-34` 所有权校验直接写进 WHERE，不先查后删                                                                                | 删除自己发布的包/移除已添加的包照此                                                                                      |
| 批量存在性    | `favorite_repo.go:37-52` `IsFavoritedBatch` 返回 Set 避免 N+1                                                                                | 商城列表「是否已添加」角标抄这个                                                                                         |
| i18n          | 4 文件扁平点分 key，**同名 key 四文件行号完全相同**；`chat.emoji.*` 已被 EmojiPicker 占用                                                    | 商城新开顶层 ns（与 `favorites.` 平级）；admin 侧进 `admin.*`                                                            |
| E2E           | `favorites.spec.ts` 页面级只验「可达 + 控件可见 + 点击不崩」（注释明说不测数据加载）；MSW **无 favorites/reports handler**                   | 商城页要测出列表内容**必须先补 MSW handler**；`authenticated-nav.spec.ts` 需补新导航项断言                               |

## 数据模型（迁移 015）

```sql
-- +goose Up
-- +goose StatementBegin
-- 发布者（NULL = 官方包 或 发布者已注销）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
-- 是否在商城公开可见（官方包默认 true；用户发布时置 true）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
-- 敏感词命中标记（H1b-c 异步打标，同 messages.flagged 范式）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;
-- 下架标记：admin 处置举报后置位，商城不再展示，已添加者保留
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS taken_down BOOLEAN NOT NULL DEFAULT FALSE;

-- 用户添加的表情包（我的表情包列表 = 官方包 + 已添加包）
CREATE TABLE IF NOT EXISTS user_sticker_packs (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id    UUID        NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    sort       INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT idx_usp_user_pack UNIQUE(user_id, pack_id)
);
CREATE INDEX IF NOT EXISTS idx_usp_user ON user_sticker_packs(user_id, sort ASC, created_at DESC);
-- 商城列表：公开 + 未下架，按热度/时间排序
CREATE INDEX IF NOT EXISTS idx_packs_public ON sticker_packs(is_public, taken_down, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packs_flagged ON sticker_packs(flagged, created_at DESC) WHERE flagged = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_sticker_packs;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS taken_down;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS flagged;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS is_public;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS owner_id;
-- +goose StatementEnd
```

**设计说明：**

- **`ON DELETE SET NULL`（H1b-b）**：与仓库现有 CASCADE 惯例的**有意偏离**，理由是「已添加该包的用户不应因发布者注销而丢失」。`owner_id IS NULL` 同时表示"官方包"与"发布者已注销"两种情况——用 `is_official` 区分（官方包 `is_official=true`）。
- **`user_sticker_packs` 是关系表不是快照**：与 favorites 存内容快照的先例不同，因为表情包需要"发布者后续追加贴纸，已添加者同步看到"（H1b-g 允许编辑）。代价是发布者删包会连带消失（`ON DELETE CASCADE`）——**这是有意选择**，与 H1b-b 的"注销保留"不矛盾（注销 ≠ 主动删包；主动删包应视为发布者撤回内容）。
- **`taken_down` 而非硬删**：admin 下架违规包时置位，商城不再展示，但已添加者的 EmojiPicker 仍能用（避免影响无辜用户）。若要彻底移除，走硬删（连带 CASCADE 清理关系）。
- **`sort` 在两处**：`sticker_packs.sort`（H1 已有，官方包排序）与 `user_sticker_packs.sort`（用户自定义排序）语义不同，后者为未来"拖拽排序我的表情包"预留，本批次可不实现交互，仅保留字段。
- **贴纸多包归属（H1b-e）不需要新迁移**：`stickers` 表结构（H1 已定）已支持一张贴纸行只属于一个包（`pack_id` 单一外键）。「复制进新包」= 发布/加贴纸时插入**新的 `stickers` 行**（新 `id`，`pack_id` 指向目标包，`owner_id` 为 NULL），`object_key` 可与原收藏贴纸相同（同一 MinIO 对象，多行引用，存储零额外成本）也可以是直传的新对象——两种来源在 service 层统一处理，模型层不区分。
- **不新增 `price` 相关字段**（2026-08-09 二次确认，见「明确不做」）。
- **封面存储走公共读**（H1b-j）：`sticker_packs.cover_url`（H1 已有 `VARCHAR(500)`）直接存完整公共 URL，同头像 `PublicURL` 模式，无需预签名。需要 MinIO 侧新增 `sticker-covers/` 前缀的匿名读策略（见「后端改动点」）。

## 后端改动点（对象存储 / 上传类别）

H1b-f（直传）与 H1b-j（封面公共读）都需要扩展 `server/internal/handler/file.go` 的类别机制：

- `objectKeyPattern`（`file.go:28`）加第四个类别：`^(images|avatars|files|sticker-covers)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`
- `resolveCategory`（`file.go:152-165`）的显式 query 白名单加 `"sticker-covers"`（封面必须显式指定类别，同 avatars 现状——不能靠 content-type 推断，否则普通图片消息会被误判）
- `minio.go:70-86` 的匿名读策略 JSON 的 `Resource` 数组追加 `"arn:aws:s3:::%s/sticker-covers/*"`（与 avatars 同一 Statement 或新增一条，二选一均可，新增 Statement 更利于未来单独调整策略）
- 前端 `packages/shared/src/api/files.ts:46` 的 `category?: "images" | "avatars"` 联合类型加 `"sticker-covers"`
- 贴纸本体（发布直传的新贴纸）仍走 `category=images`（私有 + 预签名下载），只有**封面**走公共读——两者语义不同：贴纸在 EmojiPicker/气泡里渲染需要鉴权上下文（会话成员关系间接限定），封面在商城列表页面向所有登录用户甚至未来可能的匿名浏览场景，公开更合理

## API 设计

### 商城

| 方法   | 路径                                          | 说明                                                                                                                                                                     |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/sticker-packs/market?cursor=&limit=` | 商城列表：`is_public=true AND taken_down=false`，按 `created_at DESC` 排序（H1b-i），含 `added` 布尔（当前用户是否已添加，批量查询避免 N+1，照 `IsFavoritedBatch` 模式） |
| GET    | `/api/v1/sticker-packs/:id`                   | 包详情：元信息（含发布者昵称，`owner_id` 为 NULL 时显示「已注销用户」或「官方」）+ 全部贴纸 + `added` 状态                                                               |
| POST   | `/api/v1/sticker-packs/:id/add`               | 添加到我的列表（幂等，`FirstOrCreate` 于 `user_sticker_packs`）                                                                                                          |
| DELETE | `/api/v1/sticker-packs/:id/add`               | 从我的列表移除（不影响包本身）                                                                                                                                           |

### 发布与管理

| 方法   | 路径                                            | 请求体                                                                                                                                                                    | 说明                                                                                                                                                                                                                                                                                                       |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/sticker-packs`                         | `{name, cover_object_key, cover_width, cover_height, sticker_sources: [{source:"collection", sticker_id} \| {source:"upload", object_key, width, height, content_hash}]}` | 发布：创建包（`is_public=true`）+ 批量创建贴纸行（事务内，逐条按 `source` 分流——`collection` 校验 `sticker_id` 属于本人收藏后复制，`upload` 校验 `object_key` 属 `images/` 前缀后直接建行）；包名过敏感词异步打标（`flagged=true` 不阻塞发布）；**发布前校验本人已发布包数 < 20（H1b-k），达上限返回 400** |
| PATCH  | `/api/v1/sticker-packs/:id`                     | `{name?, cover_object_key?, cover_width?, cover_height?}`                                                                                                                 | 改名/换封面（H1b-g，仅本人）；改名同样过敏感词                                                                                                                                                                                                                                                             |
| POST   | `/api/v1/sticker-packs/:id/stickers`            | `{source:"collection"\|"upload", ...}`                                                                                                                                    | 给已发布的包加一张贴纸（仅本人，复用发布端点的单条分流逻辑）                                                                                                                                                                                                                                               |
| DELETE | `/api/v1/sticker-packs/:id/stickers/:stickerId` | —                                                                                                                                                                         | 从包中移除一张贴纸（仅本人；不校验"至少保留一张"，空包允许存在，由前端引导用户至少留一张）                                                                                                                                                                                                                 |
| GET    | `/api/v1/sticker-packs/mine`                    | —                                                                                                                                                                         | 我发布的包（含未公开草稿态？**本设计不引入草稿态**——`POST /sticker-packs` 一步创建即公开，理由：H1b-g 允许随时编辑，草稿态徒增状态机复杂度而无实质收益）                                                                                                                                                   |
| DELETE | `/api/v1/sticker-packs/:id`                     | —                                                                                                                                                                         | 删除我发布的包（仅本人；级联清理 `stickers`/`user_sticker_packs`，已添加者的 EmojiPicker 中该包同时消失——这是发布者主动撤回的预期行为，与 H1b-b 的"注销保留"是两种不同场景）                                                                                                                               |

### 已有端点的行为变更

- `GET /sticker-packs`（H1 的"官方包"端点）→ 语义扩展为**「我的表情包」= 官方包 + 已添加的包**，返回结构不变（`{packs: [{pack, stickers}]}`），EmojiPicker 无需改动即可展示已添加的包。**这是 H1b 让新功能自动接入 picker 的关键接缝。**

### 举报扩展

- `POST /reports` 的 `target_type` 白名单加 `sticker_pack`（改 `handler/report.go:24` binding + `model/report.go` 常量）
- `admin_service.go:165` 加 `sticker_pack` 处置分支（置 `taken_down=true`）
- `ModerationQueue.tsx:169` 扩展删除按钮条件

### 上限与防滥用

- **每用户发布包数量上限 20**（常量，非配置项）。超限 `POST /sticker-packs` 返回 400 `ErrPublishLimitExceeded`。
- 单包贴纸数量沿用 H1 既有上限（无需重复定义）。

## 前端设计

### 导航方案（移动端 5 项拥挤问题，已定）

`MainLayout.tsx` 移动端底栏保持 4 项不变（聊天/联系人/收藏/设置），**不加第 5 项**。商城入口：

- **移动端**：收藏页（`FavoritesView`）顶部加「表情商城」入口按钮；EmojiPicker 官方 tab 底部加「去商城看看」链接
- **桌面/平板**：`MainLayout.tsx` 左侧栏直接加第 5 项（无拥挤压力）

### 页面

| 页面     | 路径                                         | 内容                                                                                                                                                                                                                    |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 商城列表 | `/stickers`                                  | 包卡片网格（封面 + 名称 + 发布者 + 贴纸数 + 已添加角标）；游标分页（`created_at` 排序，见下）+「加载更多」按钮（照 FavoritesView）；空态/加载态照现有范式                                                               |
| 包详情   | `/stickers/:packId`                          | 封面 + 名称 + 发布者 + 贴纸网格预览 + 「添加/已添加」按钮 + 举报入口；**返回按钮**（URL 路由首例，需自定义，浏览器后退键行为一致即可）                                                                                  |
| 发布     | `/stickers/publish`                          | 二选一来源：①从我的收藏多选贴纸；②直传新图（复用 H1 的压缩+直传流程，上传后即为"新收藏"，可继续选入本次发布）→ 命名 → 选封面（默认取第一张）→ 发布                                                                      |
| 编辑     | `/stickers/:packId/edit`（仅发布者可见入口） | 改名、增删贴纸（增：同发布页两来源；删：从包移除，不影响原收藏）、改封面。保存后 `updated_at` 刷新，已添加者下次拉取 `GET /sticker-packs` 即看到新版本（`user_sticker_packs` 是关系表非快照，天然同步，见数据模型说明） |
| 我发布的 | `/stickers/mine`                             | 列表 + 编辑入口 + 删除                                                                                                                                                                                                  |

**商城排序**：按 `created_at DESC`（发布时间倒序），与 `idx_packs_public` 索引对齐，游标分页无漏重风险（`created_at` 全局唯一有序，不用 `sort` 字段）。不做分类/搜索/热度排序（后续需要再加）。

### 组件复用

- 包卡片：新建（无现成网格卡片组件）
- 贴纸缩略图：复用 H1 的 `StickerThumb`（EmojiPicker 内）或提取为共享组件
- 确认弹窗：`ConfirmDialog`（现有，删除包/移除时用）
- 分页按钮/空态：照 `FavoritesView` 手写（无共享组件）
- 直传新图：复用 H1/头像已有的 `compressImage` + `getUploadUrl` + `uploadToTicket` 流程

### i18n

**复用既有 `sticker.*` 命名空间**，不新开顶层 ns。`sticker.*` 已存在 13 个 key
（`packages/design-system/src/i18n/locales/zh-CN.json:241-253`：`sticker.tab.favorites`、
`sticker.tab.official`、`sticker.addToStickers`、`sticker.addSuccess`、`sticker.addFailed`、
`sticker.remove`、`sticker.send`、`sticker.addFailedExpired`、`sticker.listFailed`、
`sticker.emptyFavorites`、`sticker.emptyOfficial`、`sticker.removeFailed`、`sticker.imageFailed`），
商城相关 key 挂到它下面的二级段：`sticker.market.title` / `.add` / `.added` / `.publish` /
`.publishSuccess` / `.publishLimitExceeded` / `.edit` / `.myPacks` / `.stickerCount` /
`.byUser` / `.byOfficial` / `.deletedUser` / `.empty` / `.loadFailed` / `.report` /
`.uploadNew` / `.fromFavorites` 等。admin 侧进 `admin.moderation.*`（下架相关）。
四语言（zh-CN / en-US / ja-JP / ko-KR）与代码**同一 commit** 同步，过 `check-i18n.mjs`。

## 工作量预估

约 1.5-2 周（后端 4-5 天：迁移 + 商城/发布/编辑 API + 直传新图接线 + 举报扩展 + admin 下架；前端 5-6 天：商城列表/详情/发布/编辑四页 + 导航入口 + i18n + 测试）。较初版预估上浮，主因是"直传新图"与"编辑"两项从待定变为确定需求。

## 与 H1 的边界

H1 交付后即可独立使用（收藏 + 官方包），H1b 是纯增量。H1b 不修改 H1 的任何既有行为，唯一"扩展"是 `GET /sticker-packs` 的返回集合从"仅官方包"变为"官方包 + 已添加包"——EmojiPicker 前端代码无需改动。
