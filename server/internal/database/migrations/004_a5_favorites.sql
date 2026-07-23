-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS favorites (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID        NOT NULL,
    conversation_id UUID        NOT NULL,
    conv_name       VARCHAR(128) NOT NULL DEFAULT '',
    sender_nickname VARCHAR(64)  NOT NULL DEFAULT '',
    message_type    SMALLINT    NOT NULL DEFAULT 1,
    content         JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT idx_fav_user_msg UNIQUE(user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS favorites;
-- +goose StatementEnd
