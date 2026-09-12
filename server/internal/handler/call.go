package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// CallHandler 通话相关的 REST 端点。
//
// 通话本身全部走 WebSocket 信令；这里只有两个「拿配置」的读端点。
type CallHandler struct {
	calls  *service.CallService
	users  *repository.UserRepository
	logger *zap.Logger
}

// NewCallHandler 构造通话 handler。
func NewCallHandler(
	calls *service.CallService, users *repository.UserRepository, logger *zap.Logger,
) *CallHandler {
	return &CallHandler{calls: calls, users: users, logger: logger}
}

// callParticipantDTO 房间快照里的参与者（比 WS 帧多不了字段，但两处结构独立演进）。
type callParticipantDTO struct {
	UserID    uuid.UUID `json:"user_id"`
	ConnID    string    `json:"conn_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	State     string    `json:"state"`
}

// callRoomDTO 房间快照响应体。
type callRoomDTO struct {
	CallID         uuid.UUID            `json:"call_id"`
	ConversationID uuid.UUID            `json:"conversation_id"`
	Media          string               `json:"media"`
	State          string               `json:"state"`
	CallerID       uuid.UUID            `json:"caller_id"`
	Participants   []callParticipantDTO `json:"participants"`
}

// GetICEServers 下发 STUN/TURN 配置与临时凭据。
//
// @Summary 获取 ICE 服务器配置
// @Tags calls
// @Success 200 {object} Response
// @Router /calls/ice-servers [get]
func (h *CallHandler) GetICEServers(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	Success(c, h.calls.ICEServers(userID))
}

// GetCall 返回通话房间快照。
//
// 唯一调用方是桌面端的独立通话窗口：它是在 call.incoming 之后才被创建的，
// 自己的 WebSocket 连上时那一帧早已发完，没有这个端点就没有房间信息可渲染。
// 顺带让「通话窗口刷新 / 重开」天然可恢复。
//
// @Summary 获取通话房间快照
// @Tags calls
// @Param call_id path string true "通话 ID"
// @Success 200 {object} Response
// @Router /calls/{call_id} [get]
func (h *CallHandler) GetCall(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	callID, err := uuid.Parse(c.Param("call_id"))
	if err != nil {
		BadRequest(c, "invalid call id")
		return
	}

	room, err := h.calls.Get(c.Request.Context(), callID)
	if err != nil {
		NotFound(c, "call not found")
		return
	}

	// 只有房间参与者能读快照：里面含各方的 conn_id，那是信令的定址凭据，
	// 泄露给外人等于把「往任意参与者连接上塞帧」的门票发出去
	inRoom := false
	ids := make([]uuid.UUID, 0, len(room.Participants))
	for _, p := range room.Participants {
		ids = append(ids, p.UserID)
		if p.UserID == userID {
			inRoom = true
		}
	}
	if !inRoom {
		Error(c, http.StatusForbidden, http.StatusForbidden, "not a call participant")
		return
	}

	nick := map[uuid.UUID]string{}
	avatar := map[uuid.UUID]*string{}
	// 昵称查不到不影响通话本身：快照的关键字段是 conn_id 与 state，
	// 与「查询失败就留空」同一姿态，不因一次用户表查询挂掉整个房间快照
	if h.users != nil {
		if users, err := h.users.FindByIDs(c.Request.Context(), ids); err == nil {
			for i := range users {
				nick[users[i].ID] = users[i].Nickname
				avatar[users[i].ID] = users[i].AvatarURL
			}
		} else {
			h.logger.Warn("取通话参与者资料失败", zap.Error(err))
		}
	}

	out := callRoomDTO{
		CallID:         room.CallID,
		ConversationID: room.ConversationID,
		Media:          string(room.Media),
		State:          string(room.State),
		CallerID:       room.CallerID,
		Participants:   make([]callParticipantDTO, 0, len(room.Participants)),
	}
	for _, p := range room.Participants {
		out.Participants = append(out.Participants, callParticipantDTO{
			UserID:    p.UserID,
			ConnID:    p.ConnID,
			Nickname:  nick[p.UserID],
			AvatarURL: avatar[p.UserID],
			State:     string(p.State),
		})
	}
	Success(c, out)
}
