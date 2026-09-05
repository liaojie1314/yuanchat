package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"go.uber.org/zap"
)

// EditWindow 消息可编辑的时间窗口（自发送起 5 分钟）。
//
// 与 RecallWindow（2 分钟）刻意不对齐：编辑不改变「对方已看到过什么」的事实，
// 危害面小于撤回，可以给更宽的窗口。5 分钟取自仓内既有先例
// （前端撤回后「重新编辑」窗口 RE_EDIT_WINDOW_MS）。
const EditWindow = 5 * time.Minute

// MaxEditCount 单条消息累计可编辑次数上限（防滥用软护栏）。
const MaxEditCount int16 = 20

// MaxEditTextLen 编辑后正文的字符（rune）上限，与发送路径的文本上限对齐。
//
// 发送侧的 4000 字上限只落在 ws 帧解析层（ws.buildContent），服务层没有兜底。
// 编辑若不自己拦，就能把远超上限的正文写进 messages.content 并向全会话扇出，
// 等于绕开发送侧的长度限制 —— 与「编辑绕过敏感词审核」同一类缺口。
const MaxEditTextLen = 4000

var (
	// ErrEditWindowExpired 已超出可编辑时间窗口。
	ErrEditWindowExpired = errors.New("edit window expired")
	// ErrEditLimitExceeded 累计编辑次数已达上限。
	ErrEditLimitExceeded = errors.New("edit limit exceeded")
	// ErrNotEditable 消息类型或状态不允许编辑。
	ErrNotEditable = errors.New("message not editable")
	// ErrEditNoChange 新文本与当前文本相同，无需编辑。
	ErrEditNoChange = errors.New("text unchanged")
	// ErrEditEmptyText 新文本为空。
	ErrEditEmptyText = errors.New("text must not be empty")
	// ErrEditTextTooLong 新文本超出长度上限。
	ErrEditTextTooLong = errors.New("text too long")
)

// EditResult 编辑结果，供 handler 构造 message.edited 推送。
//
// Message.EditedAt 在每条成功返回的路径上都保证非 nil（调用方可直接解引用）。
type EditResult struct {
	Message   *model.Message
	Text      string
	MemberIDs []uuid.UUID
}

// EditVersion 编辑历史的一个版本；Current 为 true 表示当前生效版本。
type EditVersion struct {
	Version  int16     `json:"version"`
	Text     string    `json:"text"`
	EditedAt time.Time `json:"edited_at"`
	Current  bool      `json:"current,omitempty"`
}

// Edit 编辑一条文本消息的正文。
//
// 闸门顺序即失败优先级：文本非空且不超长 → 消息存在 → 本人发送 → 类型为文本 →
// 状态为 normal → 在 EditWindow 内 → 未达 MaxEditCount → 与原文有变化。
// 通过后在单事务内写历史 + CAS 更新正文，并对新文本重跑敏感词审核。
//
// 状态检查必须留在 EditWithHistory 之前：CAS 的 WHERE 同时带 status 与 edit_count，
// 返回 false 合流了「并发推进 / 非 normal / 不存在」三种成因，前两道检查前置后
// 走到 CAS 时只剩并发一种可能，才能把 false 稳定地翻译成 ErrEditNoChange。
func (s *MessageService) Edit(
	ctx context.Context,
	userID, messageID uuid.UUID,
	text string,
) (*EditResult, error) {
	if strings.TrimSpace(text) == "" {
		return nil, ErrEditEmptyText
	}
	if len([]rune(text)) > MaxEditTextLen {
		return nil, ErrEditTextTooLong
	}

	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	if msg.SenderID != userID {
		return nil, ErrNotSender
	}
	// 仅纯文本可编辑：媒体 content 无 caption 字段可改、且 content->>'key'
	// 是对象授权与 GC 的凭据；E2EE 服务端无明文；system 非用户产出。
	if msg.MessageType != model.MessageTypeText {
		return nil, ErrNotEditable
	}
	if msg.Status != model.MessageStatusNormal {
		return nil, ErrNotEditable
	}
	if time.Since(msg.CreatedAt) > EditWindow {
		return nil, ErrEditWindowExpired
	}
	if msg.EditCount >= MaxEditCount {
		return nil, ErrEditLimitExceeded
	}

	var old model.MessageContentText
	if err := json.Unmarshal([]byte(msg.Content), &old); err != nil {
		return nil, fmt.Errorf("unmarshal current content: %w", err)
	}
	if old.Text == text {
		return nil, ErrEditNoChange
	}

	newContent, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, fmt.Errorf("marshal new content: %w", err)
	}

	// 编辑必须重跑审核：否则「先发干净文本 → 编辑成敏感词」可完全绕过内容审核，
	// 且 admin 检索实时读 content->>'text'，编辑掉敏感词即从审核队列消失。
	// 反向不清标 —— 清 flagged 是 admin 的动作，用户不能靠再编辑自助洗白。
	flagged := s.textHitsModeration(msg.MessageType, string(newContent), userID)
	editedAt := time.Now().UTC()

	ok, err := s.msgRepo.EditWithHistory(ctx, messageID,
		msg.Content, string(newContent), msg.EditCount, flagged, editedAt)
	if err != nil {
		return nil, fmt.Errorf("edit message: %w", err)
	}
	// CAS 失败＝并发下已被另一次编辑推进，让调用方重试而非静默成功
	if !ok {
		return nil, ErrEditNoChange
	}

	// 同步内存副本供 handler 组帧（DB 已由 repo 更新）
	msg.Content = string(newContent)
	msg.EditedAt = &editedAt
	msg.EditCount = msg.EditCount + 1
	if flagged {
		msg.Flagged = true
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &EditResult{Message: msg, Text: text, MemberIDs: memberIDs}, nil
}

// EditHistory 取一条消息的全部版本（升序，末项为当前版本）。
//
// 可见性口径与 GetHistory 完全一致：成员校验 + cleared_before_seq 水位，
// 不另立标准。
func (s *MessageService) EditHistory(
	ctx context.Context,
	userID, messageID uuid.UUID,
) ([]EditVersion, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}

	member, ok, err := s.convRepo.GetMember(ctx, msg.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}
	// 本人清空记录后，水位以下的消息历史同步失效
	if msg.Seq <= member.ClearedBeforeSeq {
		return nil, ErrMessageNotFound
	}

	return s.buildVersions(ctx, msg)
}

// EditHistoryForAdmin 取编辑历史，跳过成员与水位校验（admin 取证用）。
func (s *MessageService) EditHistoryForAdmin(
	ctx context.Context,
	messageID uuid.UUID,
) ([]EditVersion, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	return s.buildVersions(ctx, msg)
}

// buildVersions 把历史行与当前正文拼成升序版本列表。
//
// 当前版本不存在 message_edits 里（历史表只存被替换掉的版本），
// 故在末尾按 edit_count+1 追加。
func (s *MessageService) buildVersions(
	ctx context.Context,
	msg *model.Message,
) ([]EditVersion, error) {
	edits, err := s.msgRepo.ListEdits(ctx, msg.ID)
	if err != nil {
		return nil, fmt.Errorf("list edits: %w", err)
	}

	versions := make([]EditVersion, 0, len(edits)+1)
	for _, e := range edits {
		var tc model.MessageContentText
		if err := json.Unmarshal([]byte(e.OldContent), &tc); err != nil {
			// 单条坏数据不使整个历史失败（同相册的「跳过脏 content」取舍）
			s.logger.Warn("unmarshal edit history content failed",
				zap.String("message_id", msg.ID.String()),
				zap.Int16("version", e.Version))
			continue
		}
		versions = append(versions, EditVersion{
			Version:  e.Version,
			Text:     tc.Text,
			EditedAt: e.EditedAt,
		})
	}

	var cur model.MessageContentText
	if err := json.Unmarshal([]byte(msg.Content), &cur); err != nil {
		return nil, fmt.Errorf("unmarshal current content: %w", err)
	}
	curEditedAt := msg.CreatedAt
	if msg.EditedAt != nil {
		curEditedAt = *msg.EditedAt
	}
	versions = append(versions, EditVersion{
		Version:  msg.EditCount + 1,
		Text:     cur.Text,
		EditedAt: curEditedAt,
		Current:  true,
	})

	return versions, nil
}
