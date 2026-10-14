-- +goose NO TRANSACTION

-- +goose Up
-- +goose StatementBegin
-- 文件名检索：图片/文件/视频的原始名字存在 content->>'name'，
-- 而 003 的 trgm 索引只建在 content->>'text' 上 —— 这就是「搜不到文件」的根因。
-- partial 条件与 003 保持一致，否则 planner 合并两个索引时会走到不同的可见性口径。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_name_trgm
    ON messages USING gin ((content->>'name') gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 1;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_name_trgm;
-- +goose StatementEnd
