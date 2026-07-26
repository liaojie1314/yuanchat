-- +goose Up
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN IF NOT EXISTS role SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_action_logs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id   VARCHAR(64) NOT NULL,
    detail      JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor ON admin_action_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_action_logs(action, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS admin_action_logs;
ALTER TABLE users DROP COLUMN IF EXISTS role;
-- +goose StatementEnd
