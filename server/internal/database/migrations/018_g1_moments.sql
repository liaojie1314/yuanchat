-- +goose Up
-- +goose StatementBegin
-- 朋友圈四表。可见性判定不落表，按 contacts/blocklists 现有数据实时推导
--（见 repository.MomentsRepository.VisiblePostsScope），避免好友关系变更后
-- 需要回填历史帖子的可见性快照。
CREATE TABLE IF NOT EXISTS moments_posts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content     TEXT NOT NULL DEFAULT '',
    -- media 为数组：图片 1-9 项 {key,w,h}；视频恰 1 项 {key,thumb_key,duration,w,h}。
    -- 图与视频互斥，故用单列 + media_kind 判别，不开两列（两列会出现
    -- 「都空 / 都不空」的非法组合，靠应用层约束不住）。
    media       JSONB NOT NULL DEFAULT '[]',
    media_kind  SMALLINT NOT NULL DEFAULT 0,
    visibility  SMALLINT NOT NULL DEFAULT 0,
    flagged     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT moments_posts_not_empty CHECK (content <> '' OR media_kind <> 0)
);

-- feed 与个人主页都是「按作者集合 + 时间倒序」，作者列在前；
-- id 进索引尾部是因为游标用 (created_at, id) 复合比较（同毫秒多帖不漏不重）。
CREATE INDEX IF NOT EXISTS idx_moments_posts_feed
    ON moments_posts (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_moments_posts_flagged
    ON moments_posts (created_at DESC) WHERE flagged = TRUE AND deleted_at IS NULL;

-- 对象 ACL 与 GC 都要按 key 反查媒体归属（object_acl_repo.go）。
-- jsonb_path_ops 只支持 @> 一类包含运算，不支持存在性 ? 运算符；
-- 本处只用 @>，故选它（索引比 jsonb_ops 小）。
CREATE INDEX IF NOT EXISTS idx_moments_media_gin
    ON moments_posts USING gin (media jsonb_path_ops);

CREATE TABLE IF NOT EXISTS moments_likes (
    post_id    UUID NOT NULL REFERENCES moments_posts (id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_moments_likes_post ON moments_likes (post_id, created_at);

CREATE TABLE IF NOT EXISTS moments_comments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id           UUID NOT NULL REFERENCES moments_posts (id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reply_to_user_id  UUID REFERENCES users (id) ON DELETE SET NULL,
    content           TEXT NOT NULL,
    flagged           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT moments_comments_not_empty CHECK (content <> '')
);
CREATE INDEX IF NOT EXISTS idx_moments_comments_post
    ON moments_comments (post_id, created_at) WHERE deleted_at IS NULL;

-- 互动消息（红点数据源）。user_id 是被通知人，actor_id 是操作者；
-- 自赞自评不写行，否则自己的操作会把自己的红点点亮。
CREATE TABLE IF NOT EXISTS moments_activities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    actor_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES moments_posts (id) ON DELETE CASCADE,
    comment_id UUID REFERENCES moments_comments (id) ON DELETE CASCADE,
    kind       SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_moments_act_user
    ON moments_activities (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_act_unread
    ON moments_activities (user_id) WHERE read_at IS NULL;

-- 个人状态。过期只在读时判定（EffectiveStatus），不开定时清理任务。
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_emoji VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_expires_at TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN IF EXISTS status_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS status_text;
ALTER TABLE users DROP COLUMN IF EXISTS status_emoji;
DROP TABLE IF EXISTS moments_activities;
DROP TABLE IF EXISTS moments_comments;
DROP TABLE IF EXISTS moments_likes;
DROP TABLE IF EXISTS moments_posts;
-- +goose StatementEnd
