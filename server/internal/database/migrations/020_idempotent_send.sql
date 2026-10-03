-- +goose Up
-- +goose StatementBegin
-- 发送幂等：同一发送者的同一 client_msg_id 只允许落一行。
--
-- 没有这条索引，离线补发就是重复消息生成器 —— 典型失败是「服务端已落库、
-- ack 在回程丢了」，客户端上线重发即产生第二条一模一样的消息。
--
-- 部分索引（WHERE client_msg_id IS NOT NULL）：系统消息、通话记录等
-- 服务端自行产生的消息没有 client_msg_id，不能被这条约束波及。
-- 存量重复行会让建索引失败并给出明确报错（不会半途留下不一致状态），
-- 届时需先人工去重再重跑迁移。
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_msg
  ON messages(sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_messages_sender_client_msg;
-- +goose StatementEnd
