# H1 贴纸功能审计修复清单

> 审计时间：2026-08-21 · 分支 `feature/h1-stickers` · 审计基线 commit `e82dc9e`
> 关联计划：[`2026-08-09-h1-stickers.md`](./2026-08-09-h1-stickers.md)

## 背景

H1 贴纸功能在实现过程中连续出现三次同类缺陷（`retrySend` 漏 sticker 分支、WS 发帧格式与服务端不符、
贴纸删除菜单点不掉），且每次都是全量门禁绿灯通过后才被发现。为查清是否为孤立疏漏，
派 4 个只读审计 agent 并行核查：计划完成度对账、前后端契约逐字段对账、贴纸链路安全审计、
静默失败与错误处理审计。

结论：**不是三次独立疏漏，而是同一缺口的多次表现——贴纸功能全链路只有"成功"和"沉默"两种状态，
没有"失败"这个状态**。共汇总 36 项待修，全部经人工复核并标注 `文件:行号`。

## 标注说明

- **[H1]** — 本批次引入
- **[既有]** — 之前就存在，本次审计顺带发现
- 所有条目均已实际读码验证，未验证的推测已剔除

## 完成度基线

后端 Task 1-5 约 100%（连真库实跑验证）；前端实现层 Task 6-9 约 95%；
**Task 10（i18n 正确性 + MSW mock + E2E）约 40%，一类缺口集中在此**。
计划中明确标注"留待后续"的两项（直传贴纸独立入口、多表情包分 tab）不计入未完成。

---

## 一、计划 Task 10 未完成

| #   | 问题                                                                                                                                                                                                                                     | 位置                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | 3 个 i18n key 代码名与 locale 名不一致，UI 直接显示原始 key。恶性反转：失败提示 `sticker.addFailed` 有翻译，成功提示没有——功能正常时看起来像坏了 **[H1]**                                                                                | `ChatWindow.tsx:246`、`MessageBubble.tsx:480`、`EmojiPicker.tsx:207` |
| 2   | `check-i18n.mjs` 只做 locale 之间互相对账，从不校验代码里 `t()` 的 key 是否存在——第 1 项能通过门禁的原因                                                                                                                                 | `scripts/check-i18n.mjs`                                             |
| 3   | MSW 完全没有 4 个 sticker 端点（全文件 `sticker` 命中数 = 0），而 E2E/CI 跑的正是 mock 模式，收藏/官方 tab 恒为空 **[H1]**                                                                                                               | `packages/shared/src/mocks/handlers.ts`                              |
| 4   | demo 图片消息缺 `key` 与 `seq`（全文件 `seq` 出现 0 次），mock 模式下「添加到表情」的门槛条件恒假 **[H1]**                                                                                                                               | `demoData.ts:111`（门槛在 `ChatWindow.tsx:459`）                     |
| 5   | `stickers.spec.ts` 用了应用代码里不存在的选择器（`data-kind`/`data-testid` 命中数均为 0）、未用仓库 `setAuth`/`waitForMSW` fixture、6 个用例中 4 个有 `test.skip` 兜底会静默放过、末条断言拿网格总数比 `.first()` 的 count(0/1) **[H1]** | `apps/web/e2e/stickers.spec.ts`                                      |
| 6   | `MessageBubble.test` 的定位正则 `/add.*sticker\|添加到表情/i` 恰好匹配原始 key `chat.message.addToStickers`，第 1 项改与不改都不报警（假绿） **[H1]**                                                                                    | `MessageBubble.test.tsx:56`                                          |
| 7   | EmojiPicker 删除路径零测试覆盖（仅 3 个 `it()`，无 `contextMenu`/remove 断言），恰是本批次刚修过的缺陷，现无回归防护 **[H1]**                                                                                                            | `EmojiPicker.test.tsx`                                               |

## 二、功能级 bug

| #   | 问题                                                                                                                                                                                                                                                                                                                                                                   | 位置                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 8   | **转发贴纸时 content 被降级成空文本**：`contentPayloadFromMessage` 只有 text/image/file/voice 四个 case，`MessageTypeSticker(8)` 落进 `default: {Type:"text"}`。目标会话全体成员（含转发者本人）实时看到空气泡、会话列表预览变空串；刷新后走 REST 历史才正确渲染，典型"刷新一下就好了"的诡异 bug。转发入口对贴纸完全开放。`MessageTypeE2EE(7)` 同样落 default **[H1]** | `forward.go:111-144`                                         |
| 9   | REST `kindMap` 缺 `message_type=7`：`kindMap[7] \|\| "text"` → `"text"`，而 `text` 只在 type 1\|6 赋值 → `undefined` → E2EE 单聊刷新后全部历史变空气泡，连"无法解密"占位都没有。对照：WS 实时路径有完整 e2ee 解密分支，REST 路径完全没有 **[既有]**                                                                                                                    | `chat.ts:269-301`                                            |
| 10  | `onReply` 是唯一没有 `!!msg.seq` 闸门的菜单项（`onForward`/`onFavorite`/`onRecall` 都有），且双击气泡即触发。对未 ack 的消息引用回复 → `reply_to_id` 被填入 clientMsgId → Go 侧 `*uuid.UUID` 解析失败 → 整帧 400 且 `client_msg_id` 为空串 → 该消息永久发不出、重试原样带回必然再失败、前端连"哪条失败"都无法定位 **[既有]**                                           | `ChatWindow.tsx:412`、`protocol.go:169`、`ws/handler.go:161` |
| 11  | 收藏列表无 type 8 分支 → 贴纸显示成文字气泡图标；`parseExcerpt` 命中 `c.key` 返回**硬编码英文 `"[media]"`**（违反项目 i18n 零硬编码约束）                                                                                                                                                                                                                              | `FavoritesView.tsx:18-35`                                    |
| 12  | `quote.excerpt` 对贴纸/图片/语音恒为空串，引用条只有昵称加一行空白                                                                                                                                                                                                                                                                                                     | `ChatWindow.tsx:217`                                         |
| 13  | 会话列表贴纸预览两端不同源：服务端硬编码中文 `"[表情]"`，前端 WS 路径走 `i18n.t()` → 英/日/韩界面下实时收到显示 "Sticker"、刷新后变中文（image/file/voice 同病，属既有模式）                                                                                                                                                                                           | `conversation_service.go:168`、`useChatBootstrap.ts:187`     |

## 三、静默失败与错误呈现

本节是三次踩坑的共同根因所在，第 14 项为单点修复价值最高者。

| #   | 问题                                                                                                                                                                                                                                                                                                                                                                                                              | 位置                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 14  | **服务端 21 个 `sendError` 调用点，前端只认 `message === "BLOCKED"` 一个**，`p.code` 完全未使用。其余 20 种（含贴纸两个 400、`send failed` 500、文本超 4000 字、0 字节文件）全部静默丢弃 → 消息停在 sending → 5 秒后 `armAckTimeout` 置 failed，而 `setStatus` 是纯 setter 无 toast → 用户看到转 5 秒圈然后无理由失败，点重试再来一轮。**修帧格式只移走了触发器，此缺口不动则任何新增服务端校验都会重现同样症状** | `useChatBootstrap.ts:334-340`                                 |
| 15  | 收藏时 `fetch` 不检查 `r.ok`（fetch 对 4xx/5xx 不 reject）：预签名过期 / 对象已清理 / 反代 502 时把错误页正文当图片字节，`hashBlob` 算的是那段 XML/HTML 的哈希，POST 成功、后端 200、前端弹"已添加"。**第二层后果是去重被打穿**——本次存了错误页 hash，网络恢复后收藏同一张图算出真实 hash → 不同 hash → 插入第二行，同一张图在收藏列表出现两次 **[H1]**                                                           | `ChatWindow.tsx:243`                                          |
| 16  | 列表拉取失败等于空列表：`catch(() => {})` 后 `myStickers` 仍是 `[]`，且 effect 依赖 `[activeKey, myStickers.length]` 两值都不变 → **不会重试**，必须切到别的 tab 再切回；另无空态文案。空白面板同时对应"我没收藏过" / 500 / token 过期 / 断网 / seed 从未跑成功五种现实 **[H1]**                                                                                                                                  | `EmojiPicker.tsx:82-96`                                       |
| 17  | 删除贴纸 `void removeSticker(...).then(...)` 无 catch，`void` 只丢弃返回值不捕获 rejection → 菜单已关闭、列表刷新在 `.then` 里不执行、贴纸原样留着、零提示 + 一条 unhandled rejection。第二条路径：内层 `listMyStickers().catch(() => {})` 失败也被吞 → 已删的贴纸继续显示 → 再点删除拿到 404 → 又一条 unhandled rejection **[H1]**                                                                               | `EmojiPicker.tsx:196-204`                                     |
| 18  | 贴纸图片无 `onError`，仅在 `getDownloadUrl` 上挂了 `.catch`。同仓 `MessageImage` 有完整 `LoadState = loading\|loaded\|error` + 错误占位 UI，贴纸把这套已有模式丢掉了，是相对既有实现的**退步**；叠加气泡对 sticker 特意去掉背景与内边距，失败时连一个可见的盒子都没有 **[H1]**                                                                                                                                    | `StickerImage.tsx:32-45`、`EmojiPicker.tsx` 内 `StickerThumb` |
| 19  | seed 在 MinIO 不可达时只 log 一句就继续，写入指向不存在对象的行（日志文案自己写着 "rows still seeded without real objects"）。`PresignGet` 只签名不验对象存在性 → 官方 tab 列出 8 个可点击空白格 → 点击后 `buildContent` 不校验对象存在 → 落库 / 投递 / ack 全部成功 → 双端永久空白。**且坏状态是黏的**：幂等检查按包名跳过，MinIO 修好后重跑 seed 走 "already exists, skip"，8 条坏行永不修复 **[H1]**           | `cmd/seed/main.go:84-88`、`:277-281`                          |
| 20  | `hashBlob` 用 `crypto.subtle`，非安全上下文（局域网 IP 访问自建 IM 是现实场景）下为 `undefined` → TypeError 被裸 `catch {}` 吃掉 → 每次收藏都"添加失败"且重试一百次一样。全仓仅此 2 处出现 `crypto.subtle`，而 `primitives.ts` 开头明确记载整个 E2EE 栈为迁就 es2019 / Chrome 74 才弃用 WASM 选纯 TS `@noble`；`@noble/hashes ^2.2.0` 已是 shared 依赖，换过去零新增依赖 **[H1]**                                 | `files.ts:303-309`                                            |
| 21  | E2EE 文本发送在 `await encryptFor()` **之后**才挂 `armAckTimeout`，而 `fetchPreKeyBundle` 走 `apiGet` → `fetch` 无超时 → 网络挂死时消息永久停在 sending，既不 failed 也不出现重试按钮（重试按钮仅 `status === "failed"` 时提供）。image/file/voice 的上传阶段有 try/catch 兜底，只有这条路径靠 promise 自然 settle **[既有]**                                                                                     | `messageStore.ts:804-854`                                     |

## 四、后端安全与健壮性

| #   | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 位置                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 22  | 4 条贴纸路由零限流 + `ListMine` 无 `LIMIT` + 收藏无数量上限。去重键是 `(owner_id, content_hash)`，每次换随机 hash 即绕过幂等无限插行，再并发拉全量列表 → 单请求内存 O(N) → OOM。**这是唯一"普通账号即可稳定复现、无需任何前置知识"的可利用问题**；且项目惯例明确存在：紧邻下一行的 `/reports` 挂了 `LimitByIP(10,20)`，`favorite_repo.go:59` 有 `Limit()` **[H1]**                                                                                          | `router.go:229-232`、`sticker_repo.go:43-50`                |
| 23  | WS 贴纸帧只判四字段非空：不查库、不校验 `sticker_id` 归属、不校验 `key` 与 `sticker_id` 匹配、不校验 key 前缀。且 `sticker_id` **无长度上限**，可塞到 64KB 帧上限落进 `messages.content` JSONB 并向全群扇出，**绕过文本路径的 4000 字限制**（同文件 `file` 分支的 `Name` 有 255 rune 上限，属不一致疏漏）。建议：按 `sticker_id` 查库 → 校验 `owner_id == 发送者` 或 `pack_id != NULL` → **用库里的 `object_key`/`width`/`height` 覆盖客户端传值** **[H1]** | `ws/handler.go:285-300`                                     |
| 24  | `content_hash` 只校验长度 64，不校验是否十六进制、服务端也不自算复核。跨用户影响为零（`owner_id` 恒由 JWT 派生、去重键含 owner），但自伤后果：同 hash 不同 key 时 `FirstOrCreate` 命中旧行并把旧行回写，**新 key 被静默丢弃——用户"收藏"了 B 图，列表里出现的是 A 图**。且注释与测试用例名都声称"非 64 位十六进制被拒绝"，实现只比长度、测试只喂了 `"too-short"`，64 个中文也会入库 **[H1]**                                                                 | `sticker_service.go:20,44-46`、`sticker_service_test.go:83` |
| 25  | `Add` 不做 `StatObject`，200 承诺了一个可能永远渲染不出来的贴纸。第 15、19 项的坏数据都是从这个缺口进库并变成持久状态的，补上即为纵深防御 **[H1]**                                                                                                                                                                                                                                                                                                          | `sticker_service.go:35-53`                                  |
| 26  | `FirstOrCreate` 是 SELECT + INSERT 两步非原子，并发（双击菜单 / 多端同时 / 客户端重试）撞 `idx_stickers_owner_hash` 的 PG duplicate key 错误既非 `ErrInvalidObjectKey` 也非 `ErrInvalidContentHash`，落进 handler `default` → 500 → 前端"添加失败"，**而贴纸其实已经收藏成功了**。500 语义是"状态未知"，这里状态是确定的成功 **[H1]**                                                                                                                       | `sticker_repo.go:21-26`、`handler/sticker.go:56`            |
| 27  | `object_key` 无格式与长度校验：`images/` + 300 字符 → PG `value too long for varchar(255)` → 可控 500 + 刷错误日志与 error-rate 指标（叠加第 22 项无限流可低成本放大）。`width`/`height` 用 gin `binding:"required"` 只拒零值，`-1` 可通过并入库，而 WS 侧要求 `> 0` → 负尺寸行入库后无法发送。建议复用 `handler/file.go:28` 的锚定正则 **[H1]**                                                                                                            | `sticker_service.go:40`、`handler/sticker.go:26-27`         |
| 28  | `DELETE` 是 check-then-act：owner 不在 DELETE 的 WHERE 子句里，且不检查 `RowsAffected`。当前**不可利用**（全仓无任何对 `owner_id` 的 UPDATE，窗口期内归属不可翻转；UUID 主键不复用），但并发双删时第二次影响 0 行仍返回 200 `"removed"`，属虚假成功。建议 `WHERE id = ? AND owner_id = ?` + `RowsAffected == 0` 回 404 **[H1]**                                                                                                                             | `sticker_service.go:58-70`、`sticker_repo.go:38-40`         |
| 29  | `model.Sticker` 没有 `uniqueIndex` gorm tag → 测试里 `AutoMigrate` 建出的表**没有唯一约束**，dedup 测试从来只验证了 `FirstOrCreate` 的 SELECT 分支，真实 DB 约束从未被测过（生产走 goose，约束是有的，故仅影响测试可信度） **[H1]**                                                                                                                                                                                                                         | `model/sticker.go:26,30`                                    |
| 30  | 迁移缺 `CHECK ((pack_id IS NULL) <> (owner_id IS NULL))`，model 注释声明的互斥不变量无 DB 层保障（当前不可被利用：DTO 只有 4 个字段，服务端手工构造 model，无 mass assignment）。另 `owner_id → users(id) ON DELETE CASCADE` 实为死代码（users 是软删且全仓无硬删），注销用户的贴纸行与 MinIO 对象永久残留 **[H1]**                                                                                                                                         | `011_h1_stickers.sql`                                       |
| 31  | `ListPacks` 是 1 + N 次查询且无分页无缓存。当前仅 1 包 8 张无感（包只能由 seed 创建，无 API 可建），但 H1b 表情商城上线后即成廉价放大器 **[H1]**                                                                                                                                                                                                                                                                                                            | `sticker_service.go:84-98`                                  |
| 32  | **对象生命周期**：`server/` 生产代码 `RemoveObject`/`DeleteObject` 命中数为 0，撤回只翻 status 并把 content 置 `{}`。贴纸把对象 key 从"跟随一条可撤回消息的生命周期"提升为"独立表里的永久条目 + 可向任意会话无限重放"，撤回 / 清空聊天记录对此完全无效。**不是权限提升**（直接转发图片消息等效），但隐私面的增量风险需架构决策（撤回时清对象，或收藏时服务端复制成新 key） **[H1 放大既有缺陷]**                                                            | `message_service.go:403-433`                                |
| 33  | `/files/download-url` 无对象级 ACL：任何登录用户可为任意合法格式的 key 换取有效预签名 GET（TTL 24h），而上传端点不落任何记录，服务端无归属元数据可供鉴权。整套文件机密性模型是"不可猜的 key 即凭证"（key 由服务端 `uuid.NewString()` 生成，122 bit 熵，故当前不可爆破）。需架构决策 **[既有，非本批引入]**                                                                                                                                                  | `handler/file.go:123-146`                                   |

## 五、结构性根治（防复发）

| #   | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 34  | `chatSocket.send(type: string, payload: unknown)` 无类型约束——这是帧契约漂移编译期无人拦截的直接原因。建议改为 `send<K extends keyof ClientFrames>(type: K, payload: ClientFrames[K])`，并新增与 `protocol.go` 对齐的 `ClientFrames` 类型（`reply_to_id` 可用 branded UUID 类型），可一次性挡掉第 10 项与未来同类漂移。位置：`chatSocket.ts:354`                                                                                     |
| 35  | 前端测试断言 `chatSocket.send` 收到的 **JS 对象**，Go 测试直接构造 **Go 结构体**，**两端从未跑过同一份 JSON**。贴纸现在两侧各有一份"同构但独立"的断言，只是碰巧写对了，下次改字段名照样双绿。建议建 `contracts/message-send.golden.json`（每种 content type 一个样例帧）：前端断言实际 payload 与 golden 深相等，Go 侧 `json.Unmarshal` 同一份 golden 进 `SendPayload` 再跑 `buildContent` 断言 `ok=true`，任一侧改字段名/类型即双红 |
| 36  | `sticker_service.go:16-17` 注释声称 `images/` 前缀检查"防止把 `files/` 私有文档伪造成贴纸绕过下载权限模型"，但真正挡住路径穿越的是 `handler/file.go:28` 的锚定正则（`^(images\|avatars\|files)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`，在 `:84`/`:126` 生效），且 WS 发送路径对 key 根本不做前缀检查。应把该检查降级理解为数据卫生检查并纠正注释，真正的校验按第 23 项补在 WS 侧                                                  |

### mock 模式导致的测试假绿（通用形态）

5 个 send 方法都在 mockMode 分支提前 `return`（`messageStore.ts:376/422/455/486/521`），
任何"只在 mockMode 下跑"的测试对帧契约零覆盖。建议加守卫测试：`setMessageMockMode(false)`
后断言 `chatSocket.send` 必被调用，防止将来误开 mock 让整组契约测试静默失效。

---

## 已验证排除（无需修复）

以下攻击面/疑点经实际读码确认不成立，记录挡住它们的机制以免重复排查：

| 疑点                                       | 挡住它的机制                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跨用户读 / 写 / 删贴纸                     | `owner_id` 恒由 JWT 派生（DTO 只有 4 字段，无 mass assignment）；去重键含 owner；`ListMine` 严格 `WHERE owner_id = ?` 且无客户端可控过滤参数                                             |
| 删除官方包贴纸                             | 官方贴纸 `owner_id` 为 NULL，命中 `existing.OwnerID == nil` 分支 → 403。指针 nil 判断写法正确（先判 nil 再解引用），无 nil deref 也无漏判                                                |
| SQL 注入                                   | `sticker_repo.go` 全部 6 处查询均为 `?` 占位参数化；两处 `Order` 是硬编码常量；路径参数经 `uuid.Parse` 验证                                                                              |
| 鉴权中间件遗漏                             | 4 条路由全部位于 `AuthRequired` 组内。`GET /sticker-packs` 需登录，handler 不取 userID 只是因为数据全局只读、不按人过滤                                                                  |
| `images/../../files/x.pdf` 路径穿越        | `Add` 会接受并入库（弱前缀检查通过），但那行是废数据——唯一读路径 `/files/download-url` 的锚定正则把 `..` 段直接拒掉。**贴纸表从来不是预签名的信任来源**                                  |
| 收藏（窃取）他人的贴纸行                   | 不存在"按 sticker id 收藏"的端点，`Add` 只接受 `object_key`，两用户各自持有指向同一对象的行属设计预期                                                                                    |
| `retrySend` 其他 kind 死按钮               | 5 个 kind 全部覆盖；`localUrl` 缺失只发生在 ack 成功后或 store 已清空后，届时消息不处于 failed 态                                                                                        |
| `armAckTimeout` 遗漏                       | text/image/file/voice/sticker 5 条路径全部挂载（E2EE 的时序窗口见第 21 项）                                                                                                              |
| es2019 兼容性                              | shared + ui 非测试代码零命中 `.flat`/`.flatMap`/`.at`/`.replaceAll`/`Object.fromEntries`/`Promise.allSettled`/`globalThis`/`??=`/`matchAll`/`randomUUID`/`structuredClone`/`findLast` 等 |
| 幽灵依赖                                   | shared 无 `lucide-react`/`react-i18next`；两包全部外部 import 均在自己 package.json 声明                                                                                                 |
| WS 接收帧 / REST 消息 DTO / 贴纸四端点响应 | 逐字段核对一致，无"前端读了服务端不发的字段"也无反向情况；`model.Sticker` 的 `object_key`/`width`/`height` 无 `omitempty`，恒下发                                                        |

---

## 进度

- [x] **第 1 项** i18n key 对齐（四 locale 死键 `sticker.deleteConfirm` → `sticker.remove`；
      `t("sticker.added")` → `t("sticker.addSuccess")`；`t("chat.message.addToStickers")` → `t("sticker.addToStickers")`）
- [x] **批 A｜错误呈现层**（第 14、15、16、17、18、21 项）
  - 14：`applyErrorFrame` 通用分发（抽成导出函数便于测试），无条件翻 failed +
    按 code 分类 toast + 原始英文 message 只送 Sentry；新增 `errorFrame.test.ts` 6 例
  - 15：`fetch` 显式查 `r.ok`，403/404 与网络故障分开提示
  - 16：EmojiPicker 引入 `idle/loading/done/error` 状态机，替代 `length === 0` 判断；
    补错误态 + 重试按钮、收藏/官方各自空态文案、加载骨架
  - 17：删除改乐观更新 + `catch` 回滚 + 失败 toast，不再依赖第二个网络请求刷新
  - 18：`StickerImage` 与 `StickerThumb` 补 `loading/loaded/error` 三态与 `onError`；
    错误态是可点击重试的破图占位，不再留白
  - 21：`armAckTimeout` 移到 `await encryptFor()` 之前，消除 E2EE 首发时的永久 sending 窗口
  - 顺带：贴纸按钮补 `aria-label`（原先按钮内只有 `alt=""` 的 img，无可访问名）
  - 顺带：改掉 `StickerImage.test` 中把「静默留白」写成契约的两条断言
- [x] **批 B｜后端校验与健壮性**（第 22–31 项 + 第 36 项注释纠正）
  - 22：4 条路由挂 `LimitByIP`（写 10/20、读 20/40，照 `/reports` 档位）；
    `ListMine` 改游标分页（页大小 == 收藏上限 500，即一页装得下全部，
    前端无需翻页也不会静默少几张）；单用户收藏上限 500
  - 23：WS 贴纸帧改为查库校验——`sticker_id` 必须是合法 UUID（原来只判非空，
    可塞满 64KB 帧上限落进 JSONB 向全群扇出）、必须属于发送者或属于某个表情包，
    且落库的 `key`/宽高**一律取库中权威值**，客户端传值不采信
  - 24：`content_hash` 改 `^[0-9a-f]{64}$` 正则（原来只比长度，64 个大写字母也入库）；
    补一条"长度对但非十六进制"的用例（原用例只喂了 `"too-short"`）
  - 25：新增 `storage.ObjectExists`，`Add` 前置校验对象真实存在 → 不存在回 `404`
  - 26：`AddOwned` 改 `ON CONFLICT DO NOTHING` + 回查，并发重复收藏返回既有行而非 500
  - 27：`object_key` 改锚定正则 + 长度 ≤ 255（正则的 `[0-9a-f-]+` 无界，
    单靠形态仍能过 300 字符 key 撞列宽变可控 500）；宽高须为正且 ≤ 4096
  - 28：新增 `RemoveOwned`，`owner_id` 进 `WHERE` 并检查 `RowsAffected`，
    并发双删第二次回 404 而非虚假 200
  - 29：`model.Sticker` 补 `uniqueIndex:idx_stickers_owner_hash` tag，
    使测试的 `AutoMigrate` 也建出唯一约束（此前去重用例从未验证真实 DB 约束）
  - 30：新增迁移 `012_sticker_constraints.sql`，补
    `CHECK ((pack_id IS NULL) <> (owner_id IS NULL))`；已验证 Up/Down 可逆
  - 31：`ListPacks` 改两次查询 + 内存分组，消除逐包 N+1；超软上限只告警不静默截断
  - 36：纠正 `sticker_service.go` 关于 `images/` 前缀作用的错位注释
  - 连带：`docs/CHAT_API.md` 更新四端点的校验规则、状态码、分页与 WS 帧语义
- [x] **批 C｜功能级 bug**（第 8–13 项）
  - 8：`contentPayloadFromMessage` 补 sticker 分支；签名改 `(payload, ok bool)`，
    `json.Unmarshal` 全部查错，`default` 回 `ok=false` → 推送循环**跳过并告警**，
    不再退化成 `{Type:"text"}` 空气泡（落库始终完整，刷新可见）。
    连带：`Forward` 入口拒绝 E2EE（新哨兵 `ErrForwardEncrypted` → `400`）——
    密文绑定源会话棘轮状态，转到别处是一条永久"无法解密"，且校验前置于落库
  - 9：`mapMessage` 对 `message_type=7` 给本地化占位 `e2ee.historyNotStored`
    （原先 `text` 恒 `undefined` → 刷新后 E2EE 历史全是空气泡）。
    不尝试解密：`messageStore` 无本地明文持久化，且 `decryptFrom` 有副作用
    （消耗 OTK、推进链），重放历史会污染在线会话状态
  - 10：抽出 `isServerConfirmed(msg)`（`packages/shared/src/utils/messageActions.ts`），
    ChatWindow 里 5 处手抄断言 + `onAddSticker` 全部改为调用它；
    `onReply` 由此获得 seq 闸门（原先双击气泡即可对未 ack 消息引用 → 整帧 400）
  - 11：收藏列表补 `KIND_BY_TYPE` 映射与 type 4/8 图标，`parseExcerpt` 走
    `previewBodyOf` → 去掉硬编码英文 `"[media]"`，文件优先显示文件名
  - 12：新增 `quoteExcerptOf`，气泡内 quote 块与输入框引用条共用；
    贴纸/图片/语音不再是空串（原先 Composer 对三者一律显示 `[图片]`）
  - 13：服务端只返回类型标记 `last_message.preview_kind`，`preview` 对非文本类为空串，
    文案一律由前端 `previewBodyOf` 按当前语言产出 → WS 与 REST 两条路径同源。
    新增 `TestPreviewOfNeverEmitsLocalizedText` 防止有人把中文文案写回服务端；
    顺带修既有 bug：系统消息原先落 `default` → 建群后列表预览空白
  - 客户端向后兼容：`preview_kind` 缺失时回退用 `preview` 原文（旧服务端可用）
  - 连带：`docs/CHAT_API.md` 补 `preview_kind` 字段语义与转发新增的 `400`
  - **刻意延后**：`server/internal/router/router.go:126-135` 离线推送通知体仍硬编码
    中文 `[图片]/[文件]/[语音]/[表情]`。该文案由 OS 渲染、服务端无 per-user locale 字段，
    要做需先加用户语言偏好（建表字段 + 登录/设置写入），属独立缺口，不并入第 13 项
- [x] **批 D｜Task 10 收口**（第 2、3、4、5、6、7 项）
  - 2：`check-i18n.mjs` 从「只做 locale 互相对账」扩到三层——新增
    **代码 → locale**（源码里 `t("x.y")` 的静态 key 必须存在，358 个）与
    **locale → 代码**（基准 key 必须在源码中出现过，否则判死键）。
    动态调用（`t(labelKey)` / `t(cond ? "a" : "b")` / `t(MAP[x])`）无法静态解析，
    故死键判定放宽到"任意形如 key 的字符串字面量"，上述写法仍能被认出。
    自查过：往任意源文件塞 `t("sticker.added")` 会被第 2 层精确指出文件:行号
  - 2 连带：门禁点出 **11 个真实死键**并已从四 locale 删除（452 → 441）——
    `settings.profileHint`/`accountHint`、`chat.encrypted`、`detail.media`/`files`、
    `search.jumpTo`、`admin.moderation.empty`、`report.title`/`reasonPlaceholder`/`submit`、
    `push.unsupported`。其中 report 三键与 detail 两键像是没落地的举报弹窗/详情分页，
    真要做时再按当时文案重新加（git 历史留有译文）
  - 3：MSW 补齐 4 个贴纸端点（`GET /stickers/mine`、`POST /stickers`、
    `DELETE /stickers/:id`、`GET /sticker-packs`）+ `GET /files/download-url`。
    收藏为进程内可变状态（预置 2 张、按 `content_hash` 幂等、删不存在回 404），
    校验规则与服务端同口径（key 锚定正则 / 64 位小写十六进制 hash / 宽高为正）；
    download-url 回内联 SVG 的 data URL，贴纸在 mock 模式下**真的出图**，
    不再全部落进破图占位
  - 4：demo 消息补 `seq`（失败那条**刻意不给**，作为"入口应禁用"的反例样本）、
    图片消息补 `image.key` → mock 模式下「添加到表情」门槛不再恒假
  - 5：`stickers.spec.ts` 重写为 9 例，全部走仓库既有 `setAuth` + `waitForMSW` 夹具
    （原实现走真实登录表单 + 真实后端，CI 无后端必挂）；选择器改用真实存在的
    `[data-kind]`（本批为气泡本体补上）、`[data-sticker-id]`、role=tab/menuitem + 实际文案；
    **删掉全部 4 处 `test.skip` 兜底**（前置条件不满足时静默通过 = 没测）；
    末例的数量断言改为删除前后真实对比（原先拿 `.first().count()` 恒为 0/1 比较）。
    反向验证过：把 MSW 的 `/sticker-packs` 改名后「官方 tab 列出 8 张」立刻失败
  - 6：`MessageBubble.test` 的 `/add.*sticker|添加到表情/i` 换成按当前语言的实际译文
    定位，并断言译文 ≠ key 本身（原正则恰好也匹配原始 key `sticker.addToStickers`，
    i18n 写错照样绿）；顺带把 `if (item)` / `if (img)` 两处软断言改硬，
    贴纸那条改为等 `<img>` 真的挂上再点（此前同步查询恒为 null，等于从未点到）
  - 7：EmojiPicker 删除路径覆盖已由批 A 的第 17 项连带补齐（现 8 例，含删除成功、
    失败回滚 + toast、官方 tab 不提供删除），本批复核确认，无需新增
  - 连带（备注遗留）：`stickers.test` 的两条「字段缺失回退空数组」是把缺陷写成契约——
    响应结构损坏会被兜底成"你没有收藏"，与真实空列表无从区分。现改为
    `listMyStickers`/`listStickerPacks` 对非数组响应**抛错**（UI 走错误态 + 重试），
    并区分"真的空"与"结构坏"两个用例；服务端 `ListMine` 同步保证空结果是 `[]` 而非
    `nil`（否则 `null` 会撞进新的报错路径），新增 Go 用例锁死 JSON 形态
  - 连带：`docs/CHAT_API.md` 记录 `stickers`/`packs` 恒为数组的约定
- [x] **批 E｜结构性根治**（第 20、34、35 项）
  - 20：`hashBlob` 从 `crypto.subtle` 换到 `@noble/hashes`（shared 既有依赖，零新增）。
    局域网 IP 直连（`http://192.168.x.x`，本项目的现实部署形态）不是安全上下文，
    `crypto.subtle` 为 `undefined` → TypeError 被裸 `catch` 吞成"添加失败"，
    重试一百次同样失败。新增用例：删掉整个 `globalThis.crypto` 后摘要仍算得出且值不变
  - 34：`chatSocket.send(type: string, payload: unknown)` 改为
    `send<K extends keyof ClientFrames>(type: K, payload: ClientFrames[K])`，
    新增与 `protocol.go` 对齐的 `ClientFrames` 与可辨识联合 `ClientContent`
    （`{type:"sticker"}` 少带 key 这类组合现在编译不过）。
    `reply_to_id` 用 branded 类型 `ServerMessageId` + `asServerMessageId()` 断言点，
    普通 string（可能是 clientMsgId）传进去编译失败——第 10 项那类事故被搬到编译期。
    双向验证过：给 `typing` 多塞一个字段、把 `reply_to_id` 换成裸 string，`tsc` 分别报 TS2353 / TS2322
  - 35：新增 `contracts/message-send.golden.json`（8 个样本帧，覆盖 buildContent 全部
    6 种 content type，含 e2ee 首条/后续两态）。前端
    `messageSendGolden.test.ts` 驱动 store 真的发帧后与样本深比较（随机 client_msg_id
    归一成占位符）；Go 侧 `golden_contract_test.go` 以 `DisallowUnknownFields` 解进
    `SendPayload` 再跑 `buildContent`，断言 ok 与落库 message_type，另有一条
    "样本必须覆盖每种 content type"的用例。反向验证过：把样本里的 `sticker_id`
    改成 `stickerId`，前端与 Go **同时**变红
  - 连带：`docs/CHAT_API.md` 与 `docs/DEVELOPMENT.md` 记录契约位置与
    "先改 golden 再让两侧变绿"的改动顺序
- [x] **顺带清理（用户要求一并收掉）**
  - 圆角：全仓 45 处 `rounded-xl` / `rounded-2xl` / `rounded-3xl` 统一降到 `rounded-lg`
    （8px 上限约束），气泡尾角由 `rounded-b*-md` 改 `rounded-b*-sm` 以保留"尖角"观感；
    `docs/design/DESIGN_LANGUAGE.md` 的圆角表同步改写（原表把 12px/16px 写成规范，
    与项目约束直接冲突，是复发源头）
  - `docs/DEVELOPMENT.md` 的 E2E 覆盖表补上此前漏记的
    `chat-experience.spec.ts` 与 `conversation-settings.spec.ts`

- [x] **批 F｜对象存储的授权与生命周期**（第 32、33 项，用户 2026-08-22 定调）
  - 33（对象级读授权）：**按现有数据推导授权，不加归属表**。`avatars/` 前缀直接放行
    （桶策略本就是匿名公共读，校验只会制造"看起来安全"的假象）；其余 key 须满足
    「出现在某条**未撤回**消息的 `content.key` 里 + 请求者是该会话成员 + 未被本人清空水位过滤」
    或「属于本人收藏贴纸 / 属于某个表情包」，否则 `403 object not accessible`。
    新增 `repository.ObjectACLRepository`（两条 EXISTS 查询）、迁移 013 建
    `messages((content->>'key'))` 与 `stickers(object_key)` 索引（已验证 Up/Down 可逆、
    `enable_seqscan=off` 下确认走 Index Scan）。
    由此得到的语义：**撤回即撤销**（content 置 `{}` → key 从判定消失）、
    **清空即对本人撤销**、**退群/被踢即失效**。已签发的 URL 无法追回，故
    `downloadURLTTL` 从 24h 收到 **2h**（TTL 就是撤销的最坏延迟）。
    未注入 ACL 时对私有对象一律 `500` 而非放行（fail closed）——漏接线不能静默把授权关掉。
    客户端零改动：所有 presign 都发生在消息已落库之后（发送中用本地 blob 预览）；
    admin 后台从不签 URL，不受影响
  - 32（对象生命周期）：**离线 GC，不在撤回时同步删**。同一 `object_key` 可被多方引用
    （转发逐字复制 content 含 key、不同用户可各自收藏同一对象），同步删会打断别人的副本
    且需要引用计数与竞态处理；「收藏时服务端 CopyObject」也不做——有了 GC 就不必要，
    且额外占存储。新增 `cmd/gc`：扫桶 → 分批查引用 →（可选）删除。
    默认 dry-run（真删要 `-delete`）、宽限期默认 7 天（避开"字节已传、WS 帧还在路上"的窗口）、
    引用来源为 `messages.content->>'key'` / `stickers.object_key` / `users`+`conversations.avatar_url`。
    顺带回收了此前完全没人管的一类垃圾：上传成功但消息没发出去的孤儿对象。
    `storage` 补 `ListObjects`（回调式，不把全桶装内存）与 `RemoveObject`；
    `make gc-dry` / `make gc` 两个入口
  - **调度未纳入本批**：不预置 cron（改 `deploy/` 生产配置需单独评审），
    首次生产执行须先 dry-run 核对清单——已写进 `docs/DEVELOPMENT.md`
  - 测试：repository 5 例（成员可读/非成员拒/撤回后拒/本人清空后拒而他人不受影响/
    收藏与表情包归属、以及 GC 的引用判定三类来源 + 孤儿）、handler 4 例
    （403 不签发任何 URL、头像跳过 ACL、漏接线 fail closed、查库出错 500）、
    `cmd/gc` 4 例（只回收宽限期外的孤儿 / dry-run 不删 / 引用判定分批含收尾批 /
    单个删除失败不中断整轮）
  - 连带：`docs/CHAT_API.md` 新增「对象级读授权」小节与 TTL 改动；
    `docs/DEVELOPMENT.md` 新增「对象存储 GC」小节

- [ ] **仍待决策（与代码无关，纯运维）**
  - dev 与 prod 的 grafana 版本漂移（11.2.0 vs 10.2.0）、以及 GC 作业的生产调度方式，
    都要改 `deploy/` 生产配置，等用户点头再动

## 备注

- 合并 dev 前须完成本清单，并按记忆 `local-build-before-push-ci` 做四端真机 E2E
  （单元测试结构上测不出本清单中的大部分问题——36 项里有 5 项是被测试主动固化成"契约"的）。
- 三条把缺陷写成规格的测试需一并改断言：`StickerImage.test` 的「签名失败只留占位」
  （批 A 已改）、`stickers.test` 的两条「字段缺失回退空数组」（批 D 已改为对非数组
  响应抛错，并新增 Go 侧空结果必为 `[]` 的用例）。
- 批 A 未纳入的一个判断：400 类错误是**确定性失败**，重试同一帧必然再失败，
  理想做法是让重试按钮对这类消息失效。这需要给 `ChatMessage` 加 `nonRetryable` 标记
  并改 `MessageBubble` 的重试按钮渲染条件，属新增 UI 状态。
  **批 C 评估结论：不做，且不进批 D/E。** 理由：第 10 项修完后，最主要的"重试必然再失败"
  来源（`reply_to_id` 填 clientMsgId → 整帧 400）已从入口消失；剩余 400 多为内容超限，
  改内容后重发是合理路径，禁用重试反而堵死用户唯一的自救动作。
  当前行为：重试可点，每次都立即给出明确失败提示（原先是转 5 秒圈后静默失败）。
  若仍想做，需先定义"哪些 code 算不可重试"，属产品决策，请另开一项。
