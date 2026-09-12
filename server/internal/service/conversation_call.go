package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"go.uber.org/zap"
)

// callRecordContent 通话记录系统消息的 content 形状。
//
// 同时给 text 与 call 两份：老客户端只认 text，不会白屏；新客户端读 call
// 走自己的语言渲染。服务端不猜客户端的语言，text 只作最后兜底。
type callRecordContent struct {
	Text string         `json:"text"`
	Call callRecordInfo `json:"call"`
}

type callRecordInfo struct {
	Media    string `json:"media"`
	Result   string `json:"result"`
	Duration int    `json:"duration"`
}

// MemberIDsFor 返回会话成员 ID 列表，并校验 userID 确为其中一员。
//
// 通话信令层用它做两件事：发起前的权限校验，与扇出目标的解析。
// 非成员返回 ErrNotMember —— 不返回成员列表，避免把群成员构成泄露给外人。
func (s *ConversationService) MemberIDsFor(
	ctx context.Context, userID, convID uuid.UUID,
) ([]uuid.UUID, error) {
	ids, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("取会话成员失败: %w", err)
	}
	for _, id := range ids {
		if id == userID {
			return ids, nil
		}
	}
	return nil, ErrNotMember
}

// AppendCallRecord 通话终结后落一条通话记录系统消息，并推给全会话成员。
//
// 复用系统消息而不新增 message_type：渲染管线、撤回/编辑闸门、相册类型过滤、
// 内容审核、收藏映射全都按 message_type 分支，多一个类型要动的地方远多于收益。
// 未接来电靠 CreateWithSeq 递增 seq 自然计入未读，不需要额外的未读逻辑。
//
// 落库失败只记日志不返回错误：通话已经结束了，一条记录写不进去
// 不该让调用方（信令层的终结路径）以为通话没收好尾。
func (s *ConversationService) AppendCallRecord(
	ctx context.Context, convID, callerID uuid.UUID, media, result string, duration int,
) {
	content, err := json.Marshal(callRecordContent{
		Text: callRecordFallbackText(result, duration),
		Call: callRecordInfo{Media: media, Result: result, Duration: duration},
	})
	if err != nil {
		s.logger.Error("序列化通话记录失败", zap.Error(err))
		return
	}
	msg := &model.Message{
		ConversationID: convID,
		SenderID:       callerID,
		MessageType:    model.MessageTypeSystem,
		Content:        string(content),
		Status:         model.MessageStatusNormal,
	}
	if err := s.msgRepo.CreateWithSeq(ctx, msg); err != nil {
		s.logger.Error("写入通话记录失败", zap.Error(err),
			zap.String("conversation_id", convID.String()))
		return
	}
	if s.pushCallRecord != nil {
		ids, err := s.convRepo.GetMemberIDs(ctx, convID)
		if err != nil {
			return
		}
		s.pushCallRecord(ids, msg, string(content))
	}
}

// SetCallRecordPusher 注入「通话记录实时推送」回调（router 接线用）。
// 与既有的 pushSystemReceive 同一职责，但通话记录的 content 带结构化 call 字段，
// 不能走那条只发 {type:"system", text} 的路径。
func (s *ConversationService) SetCallRecordPusher(
	fn func(memberIDs []uuid.UUID, msg *model.Message, contentJSON string),
) {
	s.pushCallRecord = fn
}

// callRecordFallbackText 老客户端读的兜底正文。
//
// 刻意只在这一处出现中文：新客户端一律走 content.call + i18n。
func callRecordFallbackText(result string, duration int) string {
	switch result {
	case "answered":
		return fmt.Sprintf("通话时长 %02d:%02d", duration/60, duration%60)
	case "missed":
		return "未接来电"
	case "rejected":
		return "已拒绝"
	case "busy":
		return "对方忙线"
	default:
		return "已取消"
	}
}
