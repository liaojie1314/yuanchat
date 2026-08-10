-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS sticker_packs (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(64)  NOT NULL,
    cover_url   VARCHAR(500),
    is_official BOOLEAN      NOT NULL DEFAULT FALSE,
    sort        INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS stickers (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id      UUID         REFERENCES sticker_packs(id) ON DELETE CASCADE,
    owner_id     UUID         REFERENCES users(id) ON DELETE CASCADE,
    object_key   VARCHAR(255) NOT NULL,
    width        INTEGER      NOT NULL,
    height       INTEGER      NOT NULL,
    content_hash VARCHAR(64)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT idx_stickers_owner_hash UNIQUE(owner_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id);
CREATE INDEX IF NOT EXISTS idx_stickers_owner ON stickers(owner_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS stickers;
DROP TABLE IF EXISTS sticker_packs;
-- +goose StatementEnd
