-- 002_v02_additions.sql — v0.2 新增表与列（原由 AutoMigrate 管理）
-- 包含：message_reactions、blocklists、conversation_members.mention_unread、
-- messages 的 reply_to_id / mentions / client_msg_id 列，
-- 以及 messages 联合唯一索引修正。

-- +goose Up
-- +goose StatementBegin

-- ============================================
-- 消息表情回应表
-- ============================================
CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(32) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- ============================================
-- 拉黑名单表
-- ============================================
CREATE TABLE IF NOT EXISTS blocklists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_blocklist_user ON blocklists(user_id);

-- ============================================
-- conversation_members: 群消息 @ 未读标记
-- ============================================
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS mention_unread BOOLEAN DEFAULT FALSE;

-- ============================================
-- messages: v0.2 新增列（已在 001_baseline 的 DDL 里，但针对已有库的 ALTER 补丁）
-- ============================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id    UUID REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions       UUID[];
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id  VARCHAR(64);

-- ============================================
-- messages: 修正联合唯一索引（旧 GORM AutoMigrate 可能建了单列索引）
-- ============================================
DROP INDEX IF EXISTS idx_conversation_seq;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_seq ON messages(conversation_id, seq);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_conversation_seq;
ALTER TABLE messages DROP COLUMN IF EXISTS client_msg_id;
ALTER TABLE messages DROP COLUMN IF EXISTS mentions;
ALTER TABLE messages DROP COLUMN IF EXISTS reply_to_id;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS mention_unread;
DROP TABLE IF EXISTS blocklists;
DROP TABLE IF EXISTS message_reactions;

-- +goose StatementEnd
