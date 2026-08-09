-- +goose Up
-- +goose StatementBegin
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_before_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS alias VARCHAR(30);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS announcement TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS announcement_updated_at TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE conversations DROP COLUMN IF EXISTS announcement_updated_at;
ALTER TABLE conversations DROP COLUMN IF EXISTS announcement;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS alias;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS cleared_before_seq;
-- +goose StatementEnd
