-- +goose NO TRANSACTION

-- +goose Up
-- +goose StatementBegin
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_text_trgm
    ON messages USING gin ((content->>'text') gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 1;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_text_trgm;
-- +goose StatementEnd
