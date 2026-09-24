package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// MessageHandler 历史消息 REST 端点。
type MessageHandler struct {
	svc        *service.MessageService
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewMessageHandler(svc *service.MessageService, dispatcher ws.Dispatcher, logger *zap.Logger) *MessageHandler {
	return &MessageHandler{svc: svc, dispatcher: dispatcher, logger: logger}
}

// History 分页返回某会话的消息（按 seq 倒序）。
//
//	@Summary		拉取消息历史
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"会话 id"
//	@Param			before_seq	query	int		false	"拉取 seq < before_seq 的消息；0 表示最新"
//	@Param			limit		query	int		false	"每页条数，默认 30，上限 100"
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations/{id}/messages [get]
func (h *MessageHandler) History(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid conversation id")
		return
	}

	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	msgs, err := h.svc.GetHistory(c.Request.Context(), userID, convID, beforeSeq, limit)
	if err != nil {
		if errors.Is(err, service.ErrNotMember) {
			Error(c, 403, 403, "not a conversation member")
			return
		}
		h.logger.Error("get history failed", zap.Error(err))
		InternalError(c, "failed to load messages")
		return
	}

	// 满页说明可能还有更早的消息
	Success(c, gin.H{
		"messages": msgs,
		"has_more": len(msgs) == limit,
	})
}

// Media 返回会话媒体相册（按 message_type 过滤，seq 降序游标分页）。
//
//	@Summary		会话媒体相册
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"会话 id"
//	@Param			type		query	string	false	"媒体类型 all|image|file|voice|video|sticker，默认 all"
//	@Param			before_seq	query	int		false	"拉取 seq < before_seq 的媒体；0 表示最新"
//	@Param			limit		query	int		false	"每页条数，默认 30，上限 100"
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations/{id}/media [get]
func (h *MessageHandler) Media(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid conversation id")
		return
	}

	typeFilter := c.DefaultQuery("type", "all")
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	items, err := h.svc.GetMedia(c.Request.Context(), userID, convID, typeFilter, beforeSeq, limit)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a conversation member")
		case errors.Is(err, service.ErrInvalidMediaType):
			BadRequest(c, "invalid media type")
		default:
			h.logger.Error("get media failed", zap.Error(err))
			InternalError(c, "failed to load media")
		}
		return
	}

	// 满页说明可能还有更早的媒体（与 History 的 has_more 同口径：
	// limit 在 service 层同样做过归一，故这里比较的 limit 与实际取数一致）
	Success(c, gin.H{
		"items":    items,
		"has_more": len(items) == limit,
	})
}

// Recall 撤回消息（发送者本人、2 分钟窗口内）。
//
//	@Summary		撤回消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/recall [post]
func (h *MessageHandler) Recall(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}

	result, err := h.svc.Recall(c.Request.Context(), userID, msgID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotSender):
			Error(c, http.StatusForbidden, 403, "only the sender can recall")
		case errors.Is(err, service.ErrRecallWindowExpired):
			Error(c, http.StatusForbidden, 4031, "recall window expired")
		default:
			h.logger.Error("recall failed", zap.Error(err))
			InternalError(c, "recall failed")
		}
		return
	}

	if !result.Idempotent {
		if frame, err := ws.Encode(ws.TypeMessageRecalled, ws.MessageRecalledPayload{
			MessageID:        result.Message.ID,
			ConversationID:   result.Message.ConversationID,
			Seq:              result.Message.Seq,
			OperatorID:       userID,
			OperatorNickname: result.OperatorNickname,
		}); err == nil {
			h.dispatcher.SendToUsers(result.MemberIDs, frame)
		} else {
			h.logger.Error("encode message.recalled failed", zap.Error(err))
		}
	}
	Success(c, gin.H{"message": "recalled"})
}

// EditBody 编辑消息请求体。
//
// max 与 service.MaxEditTextLen 同值（validator 对字符串按 rune 计数，口径一致）；
// 前置拦截省掉一次库往返，服务层仍独立校验，两道都在。
type EditBody struct {
	Text string `json:"text" binding:"required,max=4000"`
}

// Edit 编辑一条文本消息（发送者本人、EditWindow 内、累计不超 MaxEditCount 次），
// 成功后向会话全员推 message.edited 帧。
//
//	@Summary		编辑消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id		path		string		true	"消息 id"
//	@Param			body	body		EditBody	true	"新正文"
//	@Success		200		{object}	Response
//	@Router			/api/v1/messages/{id} [patch]
func (h *MessageHandler) Edit(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	var body EditBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, "invalid text")
		return
	}

	result, err := h.svc.Edit(c.Request.Context(), userID, msgID, body.Text)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotSender):
			Error(c, http.StatusForbidden, 403, "only the sender can edit")
		case errors.Is(err, service.ErrEditWindowExpired):
			// 业务码 4032：紧邻 recall 的 4031，前端按 code 识别并提示窗口过期
			Error(c, http.StatusForbidden, 4032, "edit window expired")
		case errors.Is(err, service.ErrEditLimitExceeded):
			Error(c, http.StatusBadRequest, 4033, "edit limit exceeded")
		// 以下四类共用 4004（前端一律提示「无法保存」），message 各自区分便于排查。
		// ErrEditTextTooLong 必须显式列出：落进 default 会返 500，
		// 把「文本太长」误报成服务器故障。
		case errors.Is(err, service.ErrNotEditable):
			Error(c, http.StatusBadRequest, 4004, "message not editable")
		case errors.Is(err, service.ErrEditNoChange):
			Error(c, http.StatusBadRequest, 4004, "text unchanged")
		case errors.Is(err, service.ErrEditEmptyText):
			Error(c, http.StatusBadRequest, 4004, "text must not be empty")
		case errors.Is(err, service.ErrEditTextTooLong):
			Error(c, http.StatusBadRequest, 4004, "text too long")
		default:
			h.logger.Error("edit failed", zap.Error(err))
			InternalError(c, "edit failed")
		}
		return
	}

	// 组帧前必须判 nil：MessageEditedPayload.EditedAt 是值类型，而
	// model.Message.EditedAt 是指针。service 层保证成功路径上必已赋值，
	// 这里只是兜底 —— handler 里一次 panic 会打挂整个请求，
	// 宁可少推一帧（HTTP 仍 200，与 Recall 的「encode 失败只记日志」同姿态）。
	if result.Message.EditedAt == nil {
		h.logger.Error("edited_at is nil, skip message.edited push",
			zap.String("message_id", result.Message.ID.String()))
	} else if frame, err := ws.Encode(ws.TypeMessageEdited, ws.MessageEditedPayload{
		MessageID:      result.Message.ID,
		ConversationID: result.Message.ConversationID,
		Seq:            result.Message.Seq,
		Text:           result.Text,
		EditedAt:       *result.Message.EditedAt,
		EditCount:      result.Message.EditCount,
	}); err == nil {
		h.dispatcher.SendToUsers(result.MemberIDs, frame)
	} else {
		h.logger.Error("encode message.edited failed", zap.Error(err))
	}

	Success(c, gin.H{
		"edited_at":  result.Message.EditedAt,
		"edit_count": result.Message.EditCount,
	})
}

// EditHistory 取一条消息的编辑历史（会话成员可见，可见性口径同拉历史）。
//
//	@Summary		消息编辑历史
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path		string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/edits [get]
func (h *MessageHandler) EditHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}

	versions, err := h.svc.EditHistory(c.Request.Context(), userID, msgID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a conversation member")
		default:
			h.logger.Error("load edit history failed", zap.Error(err))
			InternalError(c, "load edit history failed")
		}
		return
	}
	Success(c, gin.H{"versions": versions})
}

// ReactBody 表情回应请求体。
type ReactBody struct {
	Emoji string `json:"emoji" binding:"required"`
}

// React 切换自己对消息的 emoji 回应（toggle 语义），推 message.reaction 帧给会话全员。
//
//	@Summary		切换消息表情回应
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/reactions [post]
func (h *MessageHandler) React(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	var body ReactBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	result, err := h.svc.ToggleReaction(c.Request.Context(), userID, msgID, body.Emoji)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a conversation member")
		case errors.Is(err, service.ErrInvalidEmoji):
			BadRequest(c, "invalid emoji")
		default:
			h.logger.Error("toggle reaction failed", zap.Error(err))
			InternalError(c, "toggle reaction failed")
		}
		return
	}

	if frame, err := ws.Encode(ws.TypeMessageReaction, ws.MessageReactionPayload{
		MessageID:      result.Message.ID,
		ConversationID: result.Message.ConversationID,
		UserID:         userID,
		Emoji:          result.Emoji,
		Count:          result.Count,
		Reacted:        result.Reacted,
	}); err == nil {
		h.dispatcher.SendToUsers(result.MemberIDs, frame)
	} else {
		h.logger.Error("encode message.reaction failed", zap.Error(err))
	}
	Success(c, gin.H{"emoji": result.Emoji, "count": result.Count, "reacted": result.Reacted})
}

// Search 全文搜索当前用户有权访问的消息。
//
//	@Summary		搜索消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			q				query	string	true	"搜索关键词（至少 3 字）"
//	@Param			conversation_id	query	string	false	"限定在该会话内搜索"
//	@Param			before			query	string	false	"分页游标（RFC3339）"
//	@Param			limit			query	int		false	"每页条数（默认 20，上限 50）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/search [get]
func (h *MessageHandler) Search(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		BadRequest(c, "q is required")
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	results, hasMore, err := h.svc.Search(
		c.Request.Context(),
		userID,
		q,
		c.Query("conversation_id"),
		c.Query("before"),
		limit,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrSearchQueryTooShort):
			BadRequest(c, "search query must be at least 3 characters")
		default:
			h.logger.Error("message search failed", zap.Error(err))
			InternalError(c, "search failed")
		}
		return
	}

	Success(c, gin.H{"results": results, "has_more": hasMore})
}
