-- +goose Up
-- +goose StatementBegin
-- 发布者（NULL = 官方包 或 发布者已注销）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
-- 是否在商城公开可见（官方包默认 true；用户发布时置 true）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
-- 敏感词命中标记（异步打标，同 messages.flagged 范式）
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;
-- 下架标记：admin 处置举报后置位，商城不再展示，已添加者保留
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS taken_down BOOLEAN NOT NULL DEFAULT FALSE;

-- 存量官方包补公开标记：列默认 FALSE 会把 015 之前入库的官方包留在商城之外，
-- 与上面「官方包默认 true」的列语义矛盾，故回填一次。
UPDATE sticker_packs SET is_public = TRUE WHERE is_official = TRUE;

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
-- 商城列表：公开 + 未下架，按发布时间倒序
CREATE INDEX IF NOT EXISTS idx_packs_public ON sticker_packs(is_public, taken_down, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packs_flagged ON sticker_packs(flagged, created_at DESC) WHERE flagged = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_sticker_packs;
DROP INDEX IF EXISTS idx_packs_flagged;
DROP INDEX IF EXISTS idx_packs_public;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS taken_down;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS flagged;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS is_public;
ALTER TABLE sticker_packs DROP COLUMN IF EXISTS owner_id;
-- +goose StatementEnd
