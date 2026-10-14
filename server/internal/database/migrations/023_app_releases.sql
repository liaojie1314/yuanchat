-- +goose Up
-- +goose StatementBegin
-- OTA 版本分发表。
--
-- 为什么自建而不只靠 GitHub Releases：国内直连 Releases 不稳（更新检查超时、
-- 下载断流，用户永远停在旧版）、没有渠道/灰度/回滚（一发就是全量，
-- 坏版本只能再发一版压过去）、Android 完全没有更新路径（Tauri updater 不支持它）。
--
-- signature 存的是 release 流水线产出的 minisign .sig 文本内容。
-- **签名私钥不入库也不进管理端进程** —— 管理端只做登记。
CREATE TABLE IF NOT EXISTS app_releases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform      varchar(16)  NOT NULL,
    arch          varchar(24)  NOT NULL,
    version       varchar(32)  NOT NULL,
    channel       varchar(16)  NOT NULL DEFAULT 'stable',
    notes         text         NOT NULL DEFAULT '',
    object_key    text         NOT NULL,
    signature     text         NOT NULL DEFAULT '',
    sha256        varchar(64)  NOT NULL DEFAULT '',
    size          bigint       NOT NULL DEFAULT 0,
    min_version   varchar(32),
    mandatory     boolean      NOT NULL DEFAULT false,
    rollout       smallint     NOT NULL DEFAULT 100 CHECK (rollout BETWEEN 0 AND 100),
    status        varchar(16)  NOT NULL DEFAULT 'draft',
    published_at  timestamptz,
    created_by    uuid         REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- 同一平台/架构/渠道下版本号唯一：重复登记同一版是运营误操作，
-- 让数据库挡住比让它产出两条互相覆盖的记录好
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_releases_unique
    ON app_releases (platform, arch, version, channel);

-- 对外查询的热路径：按平台+架构+渠道找最新的 published
CREATE INDEX IF NOT EXISTS idx_app_releases_lookup
    ON app_releases (platform, arch, channel, status, published_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS app_releases;
-- +goose StatementEnd
