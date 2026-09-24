-- +goose Up
-- +goose StatementBegin
-- pack_id / owner_id 互斥不变量固化到 DB：model.Sticker 的注释早已声明
-- 「属于表情包 或 属于某用户，两者互斥」，但迁移 011 只建了外键，没有任何约束
-- 保证它。当前应用层不存在 mass assignment（AddStickerBody 只有 4 个字段，
-- owner_id 恒由 JWT 派生），故无法被利用；此处补 CHECK 是把不变量下沉，
-- 避免将来新增写入路径（如 H1b 表情商城的第三方包）意外产出两者同时非空/同时为空的行。
ALTER TABLE stickers
    DROP CONSTRAINT IF EXISTS chk_stickers_owner_xor_pack;
ALTER TABLE stickers
    ADD CONSTRAINT chk_stickers_owner_xor_pack
    CHECK ((pack_id IS NULL) <> (owner_id IS NULL));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE stickers
    DROP CONSTRAINT IF EXISTS chk_stickers_owner_xor_pack;
-- +goose StatementEnd
