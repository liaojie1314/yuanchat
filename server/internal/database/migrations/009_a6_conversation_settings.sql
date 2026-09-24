-- +goose Up
-- +goose StatementBegin
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE conversation_members DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS is_pinned;
-- +goose StatementEnd
