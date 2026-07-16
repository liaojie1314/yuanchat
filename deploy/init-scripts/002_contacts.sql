-- 002_contacts.sql — 好友申请表（联系人体系第二批结构）
-- contacts 表已在 001_init.sql 创建；本文件仅补充 friend_requests。
-- 已有开发库由服务启动时的定向 AutoMigrate 覆盖，此脚本服务于全新环境初始化。

CREATE TABLE IF NOT EXISTS friend_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message      VARCHAR(200),
    status       SMALLINT NOT NULL DEFAULT 0,  -- 0 pending / 1 accepted / 2 rejected
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(requester_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_target ON friend_requests(target_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON friend_requests(requester_id, status);
