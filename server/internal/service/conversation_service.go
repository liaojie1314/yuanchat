package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ConversationDTO 会话列表条目（REST 响应结构）。
type ConversationDTO struct {
	ID            uuid.UUID       `json:"id"`
	Type          int16           `json:"type"`
	Name          string          `json:"name"`
	AvatarURL     *string         `json:"avatar_url,omitempty"`
	MemberCount   int64           `json:"member_count"`
	UnreadCount   int64           `json:"unread_count"`
	IsMuted       bool            `json:"is_muted"`
	LastSeq       int64           `json:"last_seq"`
	MyLastReadSeq int64           `json:"my_last_read_seq"`
	LastMessage   *LastMessageDTO `json:"last_message,omitempty"`
	Peer          *PeerDTO        `json:"peer,omitempty"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// LastMessageDTO 会话预览用的最后一条消息摘要。
type LastMessageDTO struct {
	Preview        string    `json:"preview"`
	SenderNickname string    `json:"sender_nickname"`
	CreatedAt      time.Time `json:"created_at"`
}

// PeerDTO 单聊对端用户信息。
type PeerDTO struct {
	ID        uuid.UUID `json:"id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
}

// ConversationService 会话列表服务。
type ConversationService struct {
	convRepo *repository.ConversationRepository
	msgRepo  *repository.MessageRepository
	logger   *zap.Logger
}

func NewConversationService(
	convRepo *repository.ConversationRepository,
	msgRepo *repository.MessageRepository,
	logger *zap.Logger,
) *ConversationService {
	return &ConversationService{convRepo: convRepo, msgRepo: msgRepo, logger: logger}
}

// List 返回用户的会话列表 DTO：
// 未读数 = last_seq - last_read_seq；单聊补对端信息作为显示名。
func (s *ConversationService) List(ctx context.Context, userID uuid.UUID) ([]ConversationDTO, error) {
	items, err := s.convRepo.ListByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}

	dtos := make([]ConversationDTO, 0, len(items))
	for _, item := range items {
		dto := ConversationDTO{
			ID:            item.ID,
			Type:          item.Type,
			MemberCount:   item.MemberCount,
			IsMuted:       item.IsMuted,
			LastSeq:       item.LastSeq,
			MyLastReadSeq: item.LastReadSeq,
			UnreadCount:   max(item.LastSeq-item.LastReadSeq, 0),
			AvatarURL:     item.AvatarURL,
			UpdatedAt:     item.UpdatedAt,
		}
		if item.Name != nil {
			dto.Name = *item.Name
		}

		// 单聊：显示名/头像取对端用户
		if item.Type == model.ConversationTypePrivate {
			peer, err := s.convRepo.GetPeerUser(ctx, item.ID, userID)
			if err != nil {
				s.logger.Warn("load peer failed", zap.Error(err), zap.String("conv_id", item.ID.String()))
			} else if peer != nil {
				dto.Peer = &PeerDTO{ID: peer.ID, Nickname: peer.Nickname, AvatarURL: peer.AvatarURL}
				if dto.Name == "" {
					dto.Name = peer.Nickname
				}
				if dto.AvatarURL == nil {
					dto.AvatarURL = peer.AvatarURL
				}
			}
		}

		if last, err := s.msgRepo.GetLastMessage(ctx, item.ID); err == nil && last != nil {
			dto.LastMessage = &LastMessageDTO{
				Preview:        previewOf(last),
				SenderNickname: last.SenderNickname,
				CreatedAt:      last.CreatedAt,
			}
		}

		dtos = append(dtos, dto)
	}
	return dtos, nil
}

// previewOf 将消息内容压缩为列表预览文案。
func previewOf(m *repository.MessageWithSender) string {
	switch m.MessageType {
	case model.MessageTypeText:
		var c model.MessageContentText
		if err := json.Unmarshal([]byte(m.Content), &c); err == nil {
			return c.Text
		}
		return ""
	case model.MessageTypeImage:
		return "[图片]"
	case model.MessageTypeFile:
		return "[文件]"
	case model.MessageTypeVoice:
		return "[语音]"
	case model.MessageTypeVideo:
		return "[视频]"
	default:
		return ""
	}
}
