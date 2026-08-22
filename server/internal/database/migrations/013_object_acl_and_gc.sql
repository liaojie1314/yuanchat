-- +goose Up
-- +goose StatementBegin
-- 对象级授权（H1 审计第 33 项）与对象 GC（第 32 项）共用的两个索引。
--
-- /files/download-url 此前只校验 key 的格式，任何登录用户都能为任意合法格式的 key
-- 换到 24h 预签名 GET：机密性全靠"key 不可猜"，且撤回/清空聊天记录对已泄漏的 key
-- 毫无约束力。现在改为按现有数据推导授权——key 必须出现在某条**未撤回**消息的
-- content 里且请求者是该会话成员（且未被本人清空水位过滤），或该 key 属于请求者的
-- 收藏贴纸/某个表情包。两条判定都要按 key 反查，故建索引：
--
--   1. messages 的 (content->>'key') 表达式索引：content 是 JSONB，媒体消息把对象 key
--      放在 content.key（image/file/voice/sticker 四类）。撤回会把 content 置 '{}'，
--      该行自然从索引结果里消失 —— 这正是"撤回即撤销访问"的实现方式。
--   2. stickers 的 object_key 索引：贴纸表按 key 反查归属（本人收藏或属于表情包）。
--
-- 同一对索引也是 cmd/gc 的基础：GC 判定"某对象是否仍被引用"走的是同样的反查。
CREATE INDEX IF NOT EXISTS idx_messages_content_key ON messages ((content ->> 'key'));
CREATE INDEX IF NOT EXISTS idx_stickers_object_key ON stickers (object_key);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_messages_content_key;
DROP INDEX IF EXISTS idx_stickers_object_key;
-- +goose StatementEnd
