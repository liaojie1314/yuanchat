# 朋友圈（Moments）设计文档

- 日期：2026-09-13
- 范围：G1（朋友圈后端）+ G2（朋友圈前端三端）+ K11（个人状态）+ 导航/收藏位置调整 + handler 包 Redis 用例去 Skip
- 基线：dev @ `ed3f3ec`，迁移已到 `017_message_edit.sql`
- 前序 outline：`plans/2026-07-31-v0.4-v0.5-social-and-calls.md` §G（本文取代其细节，冲突以本文为准）

---

## 1. 目标与非目标

**目标**：好友可见的图文/视频动态闭环 —— 发布、信息流、点赞、评论、互动红点、
删除、内容安全打标；三端（Web / 桌面 / 移动）响应式 UI；顺带补个人状态与两处
导航结构调整。

**非目标（本批不做，已在第 9 节登记为债）**：分组可见性（标签/黑名单可见）、
「仅共同好友可见评论」、转发到会话、@ 提及好友、地理位置、话题标签、
朋友圈独立的 admin 审核页（复用现有 flagged UGC 队列）。

---

## 2. 决策记录

| 编号 | 决策                                                                     | 理由                                                                                        |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| M-1  | 可见性两档：`friends`（所有好友）/ `private`（仅自己）                   | 用户确认。分组可见性复杂度高（标签表 + 交并集判定），v1 不做                                |
| M-2  | 点赞/评论对「能看到该帖的人」全部可见                                    | 沿用 outline G1-a。微信式「仅共同好友可见」需要好友交集运算，v1.2 再议                      |
| M-3  | 内容形态：文本 + （图 0-9 张 ｜ 视频 1 个），图与视频互斥                | 用户确认。复用 K6 的 `extractVideoMeta` 抽帧封面与 `MessageVideo` 播放器                    |
| M-4  | 媒体存一列 `media jsonb` + `media_kind` 判别                             | 图与视频互斥，开两列会出现「都空 / 都不空」的非法组合，靠应用层约束不住                     |
| M-5  | 未读互动红点：导航入口小红点 + 朋友圈页顶部铃铛（带数字）→ 互动消息页    | 用户确认。不侵入会话列表，避开与置顶/免打扰排序逻辑交叉                                     |
| M-6  | 移动端底栏第 3 格由「收藏」换成「朋友圈」，收藏移入设置页「关于」上方    | 用户确认。底栏保持 4 项，收藏是低频入口                                                     |
| M-7  | 三端「设置」入口沉底：桌面侧栏放 spacer 之后（主题/登出之上）            | 用户确认。设置永远是最后一个，后续新增导航项不必再排                                        |
| M-8  | 桌面侧栏不保留收藏入口，与移动端口径一致（收藏统一在设置页）             | 用户选了「底栏收藏→朋友圈」方案，其 preview 明确桌面侧栏为 聊天/通讯录/朋友圈/表情商城      |
| M-9  | 对象 ACL 加第三条分支：key 被对我可见的帖子引用即可读                    | **关键项**：`CanRead` 现只认「消息引用」与「贴纸归属」，朋友圈图不是消息，好友会全部 403    |
| M-10 | `ReferencedKeys`（GC）加 moments 分支                                    | 不加则 GC 把朋友圈媒体判成孤儿删除 → 帖子在、图 404                                         |
| M-11 | K11 个人状态存 `users` 新列，不扩展 presence 帧                          | presence 是「在不在线」的布尔广播 + Redis Pub/Sub 载荷；状态是可持久化用户属性，随 user DTO |
| M-12 | 状态过期只在**读时**判定，不开定时清理任务                               | `status_expires_at < now()` 即视为无状态；定时任务是纯增量复杂度                            |
| M-13 | 内容安全：发布/评论过 `ModerationService.Check` 打 `flagged`，不阻塞发布 | 用户确认，同 `messages.flagged` / `sticker_packs.flagged` 既有范式                          |
| M-14 | 删帖软删（`deleted_at`），互动级联在读路径过滤，不物理删                 | 与全仓软删口径一致；`moments_activities` 读时 join 帖子过滤                                 |
| M-15 | feed 游标用 `(created_at, id)` 复合游标                                  | 单 `created_at` 在同毫秒多帖时会漏页/重页；`id` 做 tie-breaker                              |

---

## 3. 数据模型

迁移 `018_g1_moments.sql`（017 已占用）。

### 3.1 `moments_posts`

| 列           | 类型           | 说明                                             |
| ------------ | -------------- | ------------------------------------------------ |
| `id`         | UUID PK        | `gen_random_uuid()`                              |
| `user_id`    | UUID NOT NULL  | `REFERENCES users(id) ON DELETE CASCADE`         |
| `content`    | TEXT NOT NULL  | 文本，`DEFAULT ''`，应用层限 1000 字             |
| `media`      | JSONB NOT NULL | `DEFAULT '[]'`，见 3.1.1                         |
| `media_kind` | SMALLINT       | `NOT NULL DEFAULT 0`：0=none / 1=image / 2=video |
| `visibility` | SMALLINT       | `NOT NULL DEFAULT 0`：0=friends / 1=private      |
| `flagged`    | BOOLEAN        | `NOT NULL DEFAULT FALSE`，敏感词命中标记         |
| `created_at` | TIMESTAMPTZ    | `NOT NULL DEFAULT NOW()`                         |
| `deleted_at` | TIMESTAMPTZ    | 软删                                             |

约束：`CHECK (content <> '' OR media_kind <> 0)` —— 空文本 + 无媒体的空帖没有意义。

索引：

- `idx_moments_posts_feed ON moments_posts(user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`
  —— feed 与个人主页都是「按作者集合 + 时间倒序」，作者列在前
- `idx_moments_posts_flagged ON moments_posts(created_at DESC) WHERE flagged = TRUE AND deleted_at IS NULL`

#### 3.1.1 `media` 结构

图片（`media_kind=1`，1-9 项）：

```json
[{ "key": "images/uuid.jpg", "w": 1200, "h": 900 }]
```

视频（`media_kind=2`，恰 1 项）：

```json
[
  {
    "key": "files/2026/09/uuid.mp4",
    "thumb_key": "images/2026/09/uuid.jpg",
    "duration": 12.5,
    "w": 1280,
    "h": 720
  }
]
```

前缀口径与消息一致（`handler/file.go` 的 `resolveCategory`：`video/*` 显式归
`files/`，只有可直接当图渲染的对象才进 `images/`；封面是 jpeg 故进 `images/`），
key 形如 `{category}/{yyyy}/{mm}/{uuid}{ext}`。

字段名与消息 `content` 保持一致（`key` / `thumb_key`），让 ACL 与 GC 的反查用同一套
表达式。

### 3.2 `moments_likes`

`post_id UUID NOT NULL REFERENCES moments_posts(id) ON DELETE CASCADE`、
`user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`、
`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`，
PK `(post_id, user_id)`（复合主键即幂等约束，不另建 id 列）。
索引 `idx_moments_likes_post ON moments_likes(post_id, created_at)`。

### 3.3 `moments_comments`

| 列                 | 类型          | 说明                                     |
| ------------------ | ------------- | ---------------------------------------- |
| `id`               | UUID PK       |                                          |
| `post_id`          | UUID NOT NULL | `ON DELETE CASCADE`                      |
| `user_id`          | UUID NOT NULL | `ON DELETE CASCADE`                      |
| `reply_to_user_id` | UUID NULL     | `ON DELETE SET NULL`，回复某人           |
| `content`          | TEXT NOT NULL | 应用层限 500 字，`CHECK (content <> '')` |
| `flagged`          | BOOLEAN       | `NOT NULL DEFAULT FALSE`                 |
| `created_at`       | TIMESTAMPTZ   | `NOT NULL DEFAULT NOW()`                 |
| `deleted_at`       | TIMESTAMPTZ   | 软删                                     |

索引 `idx_moments_comments_post ON moments_comments(post_id, created_at) WHERE deleted_at IS NULL`。

### 3.4 `moments_activities`

| 列           | 类型          | 说明                                   |
| ------------ | ------------- | -------------------------------------- |
| `id`         | UUID PK       |                                        |
| `user_id`    | UUID NOT NULL | **被通知人**（帖子作者），`CASCADE`    |
| `actor_id`   | UUID NOT NULL | 点赞/评论者，`CASCADE`                 |
| `post_id`    | UUID NOT NULL | `CASCADE`                              |
| `comment_id` | UUID NULL     | kind=2 时指向评论，`ON DELETE CASCADE` |
| `kind`       | SMALLINT      | 1=like / 2=comment                     |
| `created_at` | TIMESTAMPTZ   | `NOT NULL DEFAULT NOW()`               |
| `read_at`    | TIMESTAMPTZ   | NULL=未读                              |

索引 `idx_moments_act_user ON moments_activities(user_id, created_at DESC)`、
`idx_moments_act_unread ON moments_activities(user_id) WHERE read_at IS NULL`。

自己给自己点赞/评论**不写** activity（否则自己操作把自己红点点亮）。

### 3.5 `users` 新增三列（K11）

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_emoji VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_expires_at TIMESTAMPTZ;
```

`status_expires_at IS NULL` = 不自动清除。读时判定：`expires_at` 已过 → 序列化为空状态。

---

## 4. 权限模型（唯一入口）

一个 repository 方法承载全部可见性判定，所有读路径都必须经过它：

```go
// visiblePostsScope 返回「userID 可见的帖子」的 gorm 作用域。
// 可见 = 自己的帖子（含 private）∪ 好友的 friends 档帖子（且双向未拉黑）
func (r *MomentsRepository) visiblePostsScope(userID uuid.UUID) func(*gorm.DB) *gorm.DB
```

SQL（列名已按 `model/contact.go`、`model/blocklist.go` 核对）：

```sql
p.deleted_at IS NULL AND (
  p.user_id = :me
  OR (
    p.visibility = 0
    AND EXISTS (SELECT 1 FROM contacts c
                WHERE c.user_id = :me AND c.contact_user_id = p.user_id
                  AND c.status = 1 AND c.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM blocklists b
                    WHERE (b.user_id = :me AND b.target_id = p.user_id)
                       OR (b.user_id = p.user_id AND b.target_id = :me))
  )
)
```

要点：`contacts` 是**单向两行**关系表，列名 `contact_user_id`（不是 `friend_id`），
`status = 1`（`ContactStatusAccepted`）才算好友，且带 `deleted_at` 软删（删好友是双向软删）。
`blocklists` 列名 `target_id`（不是 `blocked_id`），**无 `deleted_at`**（解除拉黑物理删），
故不加软删条件。此处只查「我方向」的好友行 —— 删好友是双向软删，单向足够。

**为什么收在一处**：feed 过滤了但 `POST /:id/like` 没过滤，就是越权 —— 非好友能给
私密帖点赞并把 activity 推给作者。点赞、评论、单帖详情、评论列表全部先过这个
作用域再动写操作。

---

## 5. REST 接口

前缀 `/api/v1/moments`，全部走 JWT 中间件。

| 方法   | 路径                   | 说明                                                                   |
| ------ | ---------------------- | ---------------------------------------------------------------------- |
| POST   | `/`                    | 发布。body：`content`、`media`、`media_kind`、`visibility`。限流 10/20 |
| GET    | `/feed?cursor=&limit=` | 信息流（本人 + 好友），复合游标 `created_at_id`，limit ≤ 20 默认 20    |
| GET    | `/user/:id?cursor=`    | 某人主页帖子（过可见性作用域；非好友返回空列表而非 403，不泄漏存在性） |
| GET    | `/:id`                 | 单帖详情（含点赞者与评论列表）                                         |
| DELETE | `/:id`                 | 删帖（仅本人）。软删                                                   |
| POST   | `/:id/like`            | 点赞（幂等，`ON CONFLICT DO NOTHING`）                                 |
| DELETE | `/:id/like`            | 取消点赞（幂等）                                                       |
| POST   | `/:id/comments`        | 评论。body：`content`、`reply_to_user_id?`。限流 20/40                 |
| DELETE | `/comments/:id`        | 删评论（评论作者 **或** 帖子作者）                                     |
| GET    | `/activities?cursor=`  | 互动消息列表（含未读计数）                                             |
| POST   | `/activities/read`     | 全部标已读（body 可选 `ids` 精确标记）                                 |

个人状态（K11）：复用 `PUT /users/me`，body 增 `status_emoji` / `status_text` /
`status_duration`（秒，0/缺省=不过期；服务端换算 `status_expires_at`，客户端不传
绝对时间，避免客户端时钟偏移把状态写成已过期）。

Admin：`DELETE /api/v1/admin/moments/:id`、`DELETE /api/v1/admin/moments/comments/:id`，
写 `admin_action_logs`。动作常量加进 `model/admin_action_log.go`（与
`AdminActionDeleteMessage` / `AdminActionTakeDownPack` 同处，**不是**
`flagged_ugc.go` 里那组 reset 常量）：

```go
AdminActionDeleteMomentPost    = "delete_moment_post"
AdminActionDeleteMomentComment = "delete_moment_comment"
```

### 5.1 帖子 DTO

```json
{
  "id": "uuid",
  "user": { "id": "uuid", "nickname": "", "avatar_url": "", "status_emoji": "" },
  "content": "",
  "media_kind": 1,
  "media": [{ "key": "images/2026/09/uuid.jpg", "w": 1200, "h": 900 }],
  "visibility": 0,
  "like_count": 3,
  "liked_by_me": true,
  "likes": [{ "id": "uuid", "nickname": "" }],
  "comments": [{ "id": "", "user": {}, "reply_to_user": null, "content": "", "created_at": "" }],
  "created_at": "",
  "deletable": true
}
```

**媒体 URL 由客户端按 key 换签**，DTO 里 `media[]` 出的是 `key` / `thumb_key`
（不是 `url`），客户端调既有 `/files/download-url`。理由：files API 已有进程内
签名缓存，而服务端逐帖签名会让一次 feed 响应签最多 20×9=180 个 URL。上面 DTO
示例中的 `"url"` 字段随之改为 `"key"`：

```json
"media": [{ "key": "images/2026/09/uuid.jpg", "w": 1200, "h": 900 }]
```

---

## 6. WS 帧 `moments.activity`

```json
{
  "type": "moments.activity",
  "data": {
    "id": "uuid",
    "kind": 1,
    "post_id": "uuid",
    "actor": { "id": "uuid", "nickname": "", "avatar_url": "" },
    "comment_preview": "",
    "created_at": "2026-09-13T10:00:00Z"
  }
}
```

**必须同步登记**（否则契约测试直接红）：

1. `contracts/server-frames.golden.json` 增该帧
2. `server/internal/ws/golden_server_frames_test.go` 的 `payloadPrototypes` 增对应原型

前端 `packages/shared/src/ws/` 的帧分派表增 `moments.activity` → `momentsStore` 未读 +1。

---

## 7. 前端设计

### 7.1 导航结构调整（M-6 / M-7 / M-8）

`packages/ui/src/MainLayout.tsx`：

```
MOBILE_NAV_ITEMS = [聊天, 通讯录, 朋友圈, 设置]        // 收藏移出
DESKTOP_NAV_ITEMS = [聊天, 通讯录, 朋友圈, 表情商城]   // 设置移出常规列表
```

桌面侧栏渲染顺序改为：头像 → 分隔线 → `DESKTOP_NAV_ITEMS` → `flex-1` spacer →
**设置** → 主题切换 → 登出。设置项与常规导航项同样式（复用同一个渲染函数，
避免样式漂移），只是位置在 spacer 之后。

`badgeOf` 增 `/moments` → 未读互动数（`momentsStore.unreadCount`）。

`SettingsScreen.tsx`：加「我的收藏」行（导航到 `/favorites`，带
`state: { from: "/settings" }` 供安卓返回键回设置，同现有表情商城行的做法），
顺序为 账号 → 外观 → 表情商城 → 我的收藏 → 关于。

**现状与改法**（读代码后修正）：该文件现有两种行是不同**种类**的 ——
`NAV_GROUPS_TOP` / `NAV_GROUPS_BOTTOM` 里的项是 `setView` 内部视图切换，
而表情商城行是 `navigate` 跳走，且**只在移动端分支渲染**（`SettingsScreen.tsx:252`）；
桌面左列渲染的是扁平 `NAV_GROUPS`（账号/外观/关于三项），**今天没有商城入口**。

所以不是「桌面同序」这么简单，需要：

1. 把行模型统一成一个带判别的数组：`{ kind: "view", view, icon, labelKey, descKey }`
   与 `{ kind: "route", to, icon, labelKey, descKey }`
2. 移动端与桌面端**共用同一个数组**渲染（各自保留现有样式），
   `kind === "route"` 的行 `navigate(to, { state: { from: "/settings" } })`，
   `kind === "view"` 的行 `setView(view)`
3. 顺序在数组里写死一次：账号 → 外观 → 表情商城 → 我的收藏 → 关于

副产品：桌面设置页从此也有商城与收藏入口（此前商城桌面端只能从侧栏进，
收藏在本批已从侧栏移除 —— 若不做这步，桌面端会**完全没有**收藏入口）。

`/favorites` 路由保留（三端都靠它承载收藏页），只是导航入口位置变了。

**安卓返回键**：`/favorites` 从设置进入时按返回应回设置页，而非落「非根页面一律
回聊天页」的兜底。`useStickerBack(target)` 实现上与 sticker 无耦合（只是
`registerBackInterceptor` + `navigate(target)`），**改名为 `useBackTo`** 并在
FavoritesView 与 MomentsScreen 子页复用，sticker 侧调用点同步改名（纯重命名，
不改行为）。

`/moments` 是底栏根页面，返回键走默认兜底即可；`/moments/compose`、
`/moments/activities`、`/moments/user/:id` 三个子页用 `useBackTo("/moments")`。

### 7.2 新增文件

| 文件                                        | 职责                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/shared/src/api/moments.ts`        | REST 封装 + DTO ↔ 前端类型映射                                                         |
| `packages/shared/src/store/momentsStore.ts` | feed 列表、游标、未读互动数、乐观点赞                                                  |
| `packages/ui/src/MomentsScreen.tsx`         | 三端编排：feed 列表 + 顶栏（发布 / 铃铛）                                              |
| `packages/ui/src/MomentPostCard.tsx`        | 单帖卡片：头像 + 昵称 + 文本折叠 + 媒体网格 + 操作条                                   |
| `packages/ui/src/MomentMediaGrid.tsx`       | 1/2/3/4/9 图布局 + 视频单卡，复用 `ImageLightbox`                                      |
| `packages/ui/src/MomentComposeView.tsx`     | 发布页：文本 + 图/视频选择 + 上传进度 + 可见性选择                                     |
| `packages/ui/src/MomentActivitiesView.tsx`  | 互动消息列表，点击跳原帖                                                               |
| `packages/ui/src/UserStatusEditor.tsx`      | K11 状态编辑（emoji 选择 + 一句话 + 时长）                                             |
| `apps/web/src/pages/MomentsPage.tsx` 等     | 路由页壳（`/moments`、`/moments/compose`、`/moments/activities`、`/moments/user/:id`） |

`ChatScreen.tsx` 已 1000+ 行；朋友圈**不塞进去**，独立 Screen。

### 7.3 复用清单（不重写）

- 图片压缩 / 预签名直传 / 视频抽帧：`api/files.ts` 的 `compressImage`、
  `getUploadUrl`、`uploadToTicket`、`extractVideoMeta`、`getDownloadUrl`
- 图片查看：`ImageLightbox.tsx`
- 视频播放：`MessageVideo.tsx` / `VideoPlaybackOverlay.tsx`
- 头像：`Avatar.tsx`（K11 状态 emoji 挂在其右下角，加可选 prop）
- 时间格式化：现有 `Intl` 封装
- 骨架屏：现有 Skeleton 模式（固定宽高，CLS=0）

### 7.4 媒体网格布局

- 1 图：最大宽 240px，按原始宽高比（`media[].w/h` 已存，无需等图加载 → CLS=0）
- 2-3 图：单行等分
- 4 图：2×2
- 5-9 图：3 列网格，方形裁切（`aspect-square` + `object-cover`）
- 视频：单卡 + 播放角标，封面用 `thumb_key`

### 7.5 状态与错误态

feed：加载骨架 / 空态（「还没有动态，发一条吧」）/ 失败重试 / 到底提示。
点赞乐观更新，失败回滚 + Toast。发布上传进度按张显示，任一张失败允许重试该张。

### 7.6 i18n

新增 key 前缀 `moments.*` 与 `settings.userStatus*`、`settings.favorites*`，
四语言（zh-CN / en-US / ja-JP / ko-KR）同步补齐，`node scripts/check-i18n.mjs` 需绿。

---

## 8. 对象存储 ACL 与 GC（M-9 / M-10，关键项）

### 8.1 `ObjectACLRepository.CanRead` 增第三分支

`CanRead` 只需判定「存在性」，不需要展开数组 —— `@>` 包含运算对数组元素逐个匹配，
两次 `@>` 就够，且**整条走 GIN 索引**：

```sql
SELECT EXISTS (
  SELECT 1 FROM moments_posts p
  WHERE (p.media @> jsonb_build_array(jsonb_build_object('key', :key))
      OR p.media @> jsonb_build_array(jsonb_build_object('thumb_key', :key)))
    AND <visiblePostsScope(:me)>
)
```

不加这条：好友打开 feed 时每张图调 `/files/download-url` 全返 403，图全裂。

**索引**：

```sql
CREATE INDEX idx_moments_media_gin ON moments_posts USING gin (media jsonb_path_ops);
```

> `jsonb_path_ops` 只支持 `@>` 一类包含运算，不支持存在性 `?` 运算符；本处只用 `@>`，
> 故选它（索引比 `jsonb_ops` 小）。
>
> 只有 8.2 的 GC 反查需要 `jsonb_array_elements` —— 那里是要**取出** key 值，
> 不是测试包含关系，无法用 `@>` 替代（该分支不走 GIN，靠 `IN` 的候选集收窄）。

### 8.2 `ReferencedKeys` 增 moments 分支

```sql
SELECT DISTINCT m.elem ->> 'key' FROM moments_posts p
  CROSS JOIN jsonb_array_elements(p.media) AS m(elem)
WHERE m.elem ->> 'key' IN ?
UNION
SELECT DISTINCT m.elem ->> 'thumb_key' FROM moments_posts p
  CROSS JOIN jsonb_array_elements(p.media) AS m(elem)
WHERE m.elem ->> 'thumb_key' IN ?
```

**软删语义**：与消息撤回不同 —— 撤回把 `content` 置 `{}` 所以 key 自然失去引用；
朋友圈删帖只置 `deleted_at`，`media` 仍在。故：

- `CanRead`：作用域含 `deleted_at IS NULL` → 删帖后**签不出新 URL**（访问撤销生效）
- `ReferencedKeys`：**不过滤** `deleted_at` → 软删帖的媒体不被 GC 删除

这个不对称是刻意的：软删是可恢复的，GC 删了对象就恢复不了。若将来要回收软删
帖的媒体，应在 GC 里按「软删超过 N 天」单独处理，而不是让 `ReferencedKeys` 漏掉它们。

---

## 9. 顺带项

### 9.1 K11 个人状态

- 后端：`users` 三列（3.5）、`PUT /users/me` 扩展、user DTO 增 `status_emoji` /
  `status_text`（过期即空）
- 前端：`UserStatusEditor.tsx`（设置页 hero 下方入口）；展示位 —— 个人主页、
  `Avatar` 右下角小 emoji（新增 `statusEmoji?: string` prop）、朋友圈帖子昵称旁
- 时长选项：1h / 4h / 今天（当地时间当日 23:59）/ 不清除
- 「今天」的时区：客户端算出秒数差传 `status_duration`，服务端不猜时区

### 9.2 handler 包 Redis 用例去 Skip

`server/internal/handler/` 下仍 `t.Skipf` 的用例迁到 `internal/testutil.NewRedis(t)`
（miniredis），与 A8 已迁的 captcha 用例同法。先 `grep -rn "t.Skipf" server/internal/handler/`
列清单，逐个迁；确有无法用 miniredis 覆盖的（如依赖真实 Lua 语义），保留 Skip 并
在用例注释里写明原因。

---

## 10. 测试策略

### 10.1 后端（`go test -race ./...` 全绿）

| 用例                     | 断言                                                 |
| ------------------------ | ---------------------------------------------------- |
| 非好友拉不到 feed / 主页 | 返回空列表，不返 403（不泄漏存在性）                 |
| private 帖只有本人可见   | 好友 feed 里没有，好友直接 GET `/:id` 返 404         |
| 拉黑双向不可见           | A 拉黑 B → 双方互相看不到对方帖子                    |
| 点赞幂等                 | 连点两次 like_count 仍为 1                           |
| 非好友点赞被拒           | 403，且不产生 activity                               |
| 删帖后互动不可见         | feed 消失、activity 列表 join 过滤掉                 |
| 删评论权限               | 评论作者可删、帖子作者可删、第三方 403               |
| activities 未读计数      | 自赞自评不计数；标已读后归零                         |
| 敏感词打标               | 命中词 → `flagged=true` 且发布成功（不阻塞）         |
| ACL：好友可读朋友圈图    | `CanRead` 返 true                                    |
| ACL：非好友不可读        | `CanRead` 返 false                                   |
| ACL：删帖后不可读        | `CanRead` 返 false                                   |
| GC：软删帖媒体仍被引用   | `ReferencedKeys` 含该 key                            |
| 状态过期                 | `expires_at` 已过 → DTO 中状态为空                   |
| 媒体校验                 | media_kind=1 时 1-9 项、=2 时恰 1 项，越界 400       |
| feed 游标                | 同毫秒多帖不漏不重                                   |
| golden 契约              | `moments.activity` 字段集与 `payloadPrototypes` 一致 |

### 10.2 前端

- `momentsStore` 单测：游标追加、乐观点赞回滚、未读计数增减
- 组件测试：`MomentMediaGrid` 各图数布局、`MomentPostCard` 文本折叠、空态
- MSW mock 覆盖正常/空/错误/加载四态（约束 9）
- `MainLayout` 测试：移动底栏 4 项含朋友圈不含收藏；桌面设置在最后
- `SettingsScreen` 测试：收藏行在关于之上

### 10.3 端到端真机

- Web + 桌面（playwright-cli）：A 发帖（图）→ B feed 可见 → B 点赞评论 →
  A 导航红点 + 互动页可见 → A 删帖 → B feed 消失
- Android 模拟器 + adb：底栏 4 项布局、九宫格、图片 Lightbox、发布上传、
  返回键从收藏页回设置页、软键盘不遮发布输入框

### 10.4 本地 CI 门禁（推 dev 前必须全绿）

`node scripts/check-i18n.mjs`、`LANG=C.UTF-8 pnpm test`、web/desktop 各自
`npx tsc --noEmit`、`pnpm --filter @yuanchat/web test:e2e`、
`go vet ./...`、`go test ./...`、`go test -race ./internal/ws/`。

---

## 11. 兼容性约束

- `build.target` 保持 `es2019`（约束 12）。`jsonb` 无关，但前端不得引入未转译的
  ES2020+ 语法；`Intl.RelativeTimeFormat` 在 Chrome 74 可用（71+），可用
- 圆角上限 `rounded-lg`（约束：本仓 lg=16px），媒体网格用 `rounded-lg`
- 根字号 14px，精确 px 用方括号任意值
- 所有 UI 文案走 i18n，无硬编码
- 注释中文，导出符号必须 JSDoc / godoc

---

## 12. 实施顺序

1. 迁移 018 + model + repository（含权限作用域）
2. service + handler + router + 限流档位
3. ACL / GC 两处分支（**与 2 同批，不可延后** —— 延后则前端联调时图全裂）
4. WS 帧 + golden 契约双登记
5. 后端测试全绿
6. shared：api + store + WS 帧分派
7. UI：MomentsScreen / PostCard / MediaGrid / ComposeView / ActivitiesView
8. 导航调整（MainLayout + SettingsScreen + 路由）
9. K11（后端列 + 前端编辑器 + 展示位）
10. handler Redis 用例去 Skip
11. i18n 四语言补齐
12. 前端测试 + E2E
13. 本地 CI 全量 → 真机三端实测 → MASTER_PLAN 回写 → `--no-ff` 合 dev

---

## 13. 新登记的债（本批不做，收尾写入 MASTER_PLAN）

| 级别 | 条目                                                                 |
| ---- | -------------------------------------------------------------------- |
| ⚪   | 朋友圈分组可见性（标签 / 部分好友可见 / 不给谁看）                   |
| ⚪   | 「仅共同好友可见评论」（M-2 的 v1.2 方案）                           |
| ⚪   | 朋友圈帖子转发到会话、评论区 @ 提及                                  |
| 🟡   | GC 未回收「软删超 N 天」的朋友圈媒体（8.2 的刻意不对称，需独立策略） |
| ⚪   | 朋友圈独立 admin 审核页（当前复用 flagged UGC 队列，无帖子预览）     |
| ⚪   | 个人状态无历史/常用状态快选                                          |
