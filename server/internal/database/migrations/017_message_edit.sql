-- +goose Up
-- +goose StatementBegin
-- 消息编辑：edited_at 非空即「已编辑」（前端角标判据）；
-- edit_count 冗余计数，让「列历史前先知道有几版」不必 JOIN message_edits。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_count SMALLINT NOT NULL DEFAULT 0;

-- 编辑历史：只存被替换掉的旧版本，当前版本始终在 messages.content。
-- version 从 1 起（1 = 最初发出的那一版），故 messages.edit_count = COUNT(message_edits)。
-- 不加外键到 messages：消息是软删（deleted_at），硬外键在 admin 硬删场景会打架，
-- 且既有 favorites / flagged_ugc 同样是裸 UUID 引用。
CREATE TABLE IF NOT EXISTS message_edits (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID        NOT NULL,
    old_content JSONB       NOT NULL,
    version     SMALLINT    NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 唯一索引兼作并发护栏：并发编辑抢到同一 version 时其中一方插入失败。
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_edits_msg_ver ON message_edits(message_id, version);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS message_edits;
ALTER TABLE messages DROP COLUMN IF EXISTS edit_count;
ALTER TABLE messages DROP COLUMN IF EXISTS edited_at;
-- +goose StatementEnd
