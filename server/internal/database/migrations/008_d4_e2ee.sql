-- +goose Up
-- +goose StatementBegin

-- 身份密钥与 signed prekey：每用户一行（换设备/轮换时覆盖）
CREATE TABLE IF NOT EXISTS e2ee_identities (
    user_id                  UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    identity_dh_public_key   VARCHAR(64)  NOT NULL,  -- base64(32B X25519)
    identity_sign_public_key VARCHAR(64)  NOT NULL,  -- base64(32B Ed25519)
    signed_prekey_id         INTEGER      NOT NULL,
    signed_prekey_public     VARCHAR(64)  NOT NULL,
    signed_prekey_signature  VARCHAR(128) NOT NULL,  -- base64(64B Ed25519 签名)
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 一次性预密钥池：分发一个即删一个（前向保密的关键）
CREATE TABLE IF NOT EXISTS e2ee_one_time_prekeys (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id     INTEGER     NOT NULL,
    public_key VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT idx_otk_user_key UNIQUE(user_id, key_id)
);
CREATE INDEX IF NOT EXISTS idx_otk_user ON e2ee_one_time_prekeys(user_id, key_id);

-- 密钥备份：客户端用 PIN 派生密钥加密后的 blob，服务端只存不解
CREATE TABLE IF NOT EXISTS e2ee_key_backups (
    user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cipher_blob TEXT        NOT NULL,   -- base64 密文（含 nonce）
    salt        VARCHAR(64) NOT NULL,   -- base64，PIN → KEK 的 KDF 盐
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS e2ee_key_backups;
DROP TABLE IF EXISTS e2ee_one_time_prekeys;
DROP TABLE IF EXISTS e2ee_identities;
-- +goose StatementEnd
