-- +goose Up
-- +goose StatementBegin
ALTER TABLE messages ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_flagged ON messages(flagged, created_at DESC) WHERE flagged = TRUE;

CREATE TABLE IF NOT EXISTS reports (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,             -- message | user
    target_id   UUID        NOT NULL,
    reason      VARCHAR(500) NOT NULL DEFAULT '',
    status      SMALLINT    NOT NULL DEFAULT 0,   -- 0=待处理 1=已保留 2=已删除
    handled_by  UUID,
    handled_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS reports;
DROP INDEX IF EXISTS idx_messages_flagged;
ALTER TABLE messages DROP COLUMN IF EXISTS flagged;
-- +goose StatementEnd
