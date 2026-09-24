-- +goose Up
-- +goose StatementBegin
-- token_version 用于改密后吊销既有令牌：签发时把当前值写进 JWT 的 tv 声明，
-- 校验方比较 tv 与库中值，不一致即视为已吊销。
--
-- 只在 UserService.Refresh 与 WS 建连处校验，不在 middleware.AuthRequired 中校验——
-- 后者是纯无状态验签（零 DB / 零 Redis 读），加校验等于给每个已认证请求增加一次查库。
-- access 令牌 TTL 只有 15 分钟，因此改密后旧 access 令牌调用 REST 的残留窗口上限即 15 分钟，
-- 这是明确接受的取舍；它无法续期，也无法建立新的 WS 连接。
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN IF EXISTS token_version;
-- +goose StatementEnd
