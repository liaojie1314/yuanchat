-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT         NOT NULL,
    p256dh     VARCHAR(255) NOT NULL,
    auth       VARCHAR(255) NOT NULL,
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- 同一浏览器 endpoint 唯一：重复订阅覆盖而非堆积
    CONSTRAINT idx_push_endpoint UNIQUE(endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS push_subscriptions;
-- +goose StatementEnd
