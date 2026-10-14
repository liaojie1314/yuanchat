-- +goose Up
-- +goose StatementBegin
-- 手机号彻底移除，不再兼容。
--
-- 为什么可以直接删列而不先让存量用户补邮箱：登录的非 @ 分支会回落元聊号
-- （user_service.go 的 Login），所以「只有手机号、没有邮箱」的账号删列后
-- 仍可用元聊号 + 原密码登录，不存在被锁死在门外的账号。
DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- 只恢复结构，不恢复数据 —— 列删掉号码就没了，Down 回来的是一整列 NULL。
-- 形状照 001_baseline.sql 原样还原（列上的 UNIQUE 约束 + 一个 partial 索引），
-- 否则 Down 之后的库与从未升过级的库不是同一个 schema。
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(20) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
-- +goose StatementEnd
