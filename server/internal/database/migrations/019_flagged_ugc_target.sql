-- +goose Up
-- +goose StatementBegin
-- 命中记录补一列所指对象的 id。昵称 / bio / 群名 / 公告四类靠 user_id /
-- conversation_id 就能定位到要重置的那一行；朋友圈动态与评论是独立表，
-- 一个用户有很多条，没有这列管理端查到命中后无从处置。
ALTER TABLE flagged_ugc ADD COLUMN IF NOT EXISTS target_id UUID;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE flagged_ugc DROP COLUMN IF EXISTS target_id;
-- +goose StatementEnd
