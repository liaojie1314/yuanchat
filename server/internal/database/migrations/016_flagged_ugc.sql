-- +goose Up
-- +goose StatementBegin
-- UGC 敏感词命中记录：昵称 / bio / 群名 / 群公告写入时命中词库，
-- 内容照常落库（同 messages.flagged 打标不阻塞范式），命中详情进本表供审核队列处置。
CREATE TABLE IF NOT EXISTS flagged_ugc (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ugc_type        VARCHAR(32) NOT NULL,             -- nickname | bio | group_name | announcement
    content         TEXT        NOT NULL,
    hit_word        VARCHAR(64) NOT NULL DEFAULT '',  -- 命中的第一个敏感词
    user_id         UUID,                             -- 写入者（写入时查不到可空）
    conversation_id UUID,                             -- 群名 / 公告所属会话
    handled_at      TIMESTAMPTZ,                      -- 处置时间（NULL = 待处理）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flagged_ugc_pending ON flagged_ugc(created_at DESC) WHERE handled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_flagged_ugc_type ON flagged_ugc(ugc_type, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS flagged_ugc;
-- +goose StatementEnd
