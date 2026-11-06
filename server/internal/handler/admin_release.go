package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
	"golang.org/x/mod/semver"
)

// registerAdminReleaseRoutes 把版本分发五端点挂到 admin 组上。
//
// 单独成函数而不是写在 router.go 里：admin 组已经很长，且测试要能只挂这五条
// 而不拖进整个 Setup。
func registerAdminReleaseRoutes(g *gin.RouterGroup, h *AdminHandler) {
	g.GET("/releases", h.ListReleases)
	g.POST("/releases", h.CreateRelease)
	g.PATCH("/releases/:id", h.UpdateRelease)
	g.POST("/releases/:id/publish", h.PublishRelease)
	g.POST("/releases/:id/rollback", h.RollbackRelease)
}

// RegisterAdminReleaseRoutes 导出版本，供 router 装配调用。
func RegisterAdminReleaseRoutes(g *gin.RouterGroup, h *AdminHandler) {
	registerAdminReleaseRoutes(g, h)
}

// createReleaseRequest 登记新版本的请求体。
//
// signature 只接收调用方粘进来的 .sig 文本内容（release 流水线产物）——
// 服务端不接收签名私钥、不在服务端算签名。
type createReleaseRequest struct {
	Platform   string `json:"platform" binding:"required,max=16"`
	Arch       string `json:"arch" binding:"required,max=24"`
	Version    string `json:"version" binding:"required,max=32"`
	Channel    string `json:"channel" binding:"omitempty,oneof=stable beta"`
	Notes      string `json:"notes"`
	ObjectKey  string `json:"object_key" binding:"required"`
	Signature  string `json:"signature"`
	Sha256     string `json:"sha256" binding:"omitempty,len=64,hexadecimal"`
	Size       int64  `json:"size" binding:"omitempty,min=0"`
	MinVersion string `json:"min_version" binding:"omitempty,max=32"`
	Mandatory  bool   `json:"mandatory"`
	// Rollout 灰度比例。指针以区分「没传」与「传了 0」——
	// 0 是「暂停下发」这个明确意图，不能和缺省混在一起。
	Rollout *int16 `json:"rollout" binding:"omitempty,min=0,max=100"`
}

// updateReleaseRequest 改灰度 / 强制 / 更新说明。
//
// 刻意只有这三项：平台/架构/版本号/对象键是身份，改它们等于换一条记录。
type updateReleaseRequest struct {
	Rollout   *int16  `json:"rollout" binding:"omitempty,min=0,max=100"`
	Mandatory *bool   `json:"mandatory"`
	Notes     *string `json:"notes"`
}

// ListReleases 分页列出版本记录。
//
//	@Summary		管理端：版本列表
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			platform	query	string	false	"平台过滤"
//	@Param			channel		query	string	false	"渠道过滤"
//	@Param			status		query	string	false	"状态过滤（draft / published / rolled_back）"
//	@Param			page		query	int		false	"页码（从 1 开始）"
//	@Param			size		query	int		false	"每页条数（上限 100）"
//	@Success		200	{object}	PaginatedResponse
//	@Router			/api/v1/admin/releases [get]
func (h *AdminHandler) ListReleases(c *gin.Context) {
	page, size := pageParams(c)
	rows, total, err := h.svc.ListReleases(c.Request.Context(), repository.ReleaseFilter{
		Platform: c.Query("platform"),
		Channel:  c.Query("channel"),
		Status:   c.Query("status"),
	}, page, size)
	if err != nil {
		h.releaseError(c, err, "list releases")
		return
	}
	// 空结果必须是 [] 而不是 null，否则前端 .map 会炸
	if rows == nil {
		rows = []model.AppRelease{}
	}
	Paginated(c, rows, total, page, size)
}

// CreateRelease 登记一条新版本（draft 态）。
//
//	@Summary		管理端：登记新版本
//	@Tags			admin
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Failure		409	{object}	Response	"该平台/架构/渠道下版本号已登记"
//	@Router			/api/v1/admin/releases [post]
func (h *AdminHandler) CreateRelease(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	var req createReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	// 两个版本字段都必须可解析，保留短版本与 v 前缀，避免错误登记后永远不能下发。
	for _, version := range []string{req.Version, req.MinVersion} {
		if version != "" && !semver.IsValid("v"+strings.TrimPrefix(version, "v")) {
			BadRequest(c, "invalid release version")
			return
		}
	}

	// 缺省灰度取 100：登记完还要显式点一次「发布」才会下发，
	// 所以这里给全量是安全的 —— 真要分批就在表单里填，或登记后改配。
	rollout := int16(100)
	if req.Rollout != nil {
		rollout = *req.Rollout
	}

	rel, err := h.svc.CreateRelease(c.Request.Context(), actorID, service.CreateReleaseInput{
		Platform:   req.Platform,
		Arch:       req.Arch,
		Version:    req.Version,
		Channel:    req.Channel,
		Notes:      req.Notes,
		ObjectKey:  req.ObjectKey,
		Signature:  req.Signature,
		Sha256:     req.Sha256,
		Size:       req.Size,
		MinVersion: req.MinVersion,
		Mandatory:  req.Mandatory,
		Rollout:    rollout,
	})
	if err != nil {
		h.releaseError(c, err, "create release")
		return
	}
	Success(c, rel)
}

// UpdateRelease 改灰度 / 强制 / 更新说明。
//
//	@Summary		管理端：改版本配置
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"版本 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/releases/{id} [patch]
func (h *AdminHandler) UpdateRelease(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid release id")
		return
	}
	var req updateReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.UpdateRelease(c.Request.Context(), actorID, releaseID, service.UpdateReleaseInput{
		Rollout:   req.Rollout,
		Mandatory: req.Mandatory,
		Notes:     req.Notes,
	}); err != nil {
		h.releaseError(c, err, "update release")
		return
	}
	Success(c, gin.H{"updated": true})
}

// PublishRelease 把 draft 置为 published，对外端点随即开始下发。
//
//	@Summary		管理端：发布版本
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"版本 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/releases/{id}/publish [post]
func (h *AdminHandler) PublishRelease(c *gin.Context) {
	h.setReleaseStatus(c, model.ReleaseStatusPublished, "publish release")
}

// RollbackRelease 把 published 置为 rolled_back，对外端点立刻停止下发。
//
// 这是坏版本唯一的收敛手段 —— 先前只能再发一版压过去。
//
//	@Summary		管理端：回滚版本
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"版本 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/releases/{id}/rollback [post]
func (h *AdminHandler) RollbackRelease(c *gin.Context) {
	h.setReleaseStatus(c, model.ReleaseStatusRolledBack, "rollback release")
}

// setReleaseStatus 发布与回滚共用的状态迁移。
func (h *AdminHandler) setReleaseStatus(c *gin.Context, status, op string) {
	actorID, _ := middleware.GetUserID(c)
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid release id")
		return
	}
	if err := h.svc.SetReleaseStatus(c.Request.Context(), actorID, releaseID, status); err != nil {
		h.releaseError(c, err, op)
		return
	}
	Success(c, gin.H{"status": status})
}

// releaseError 把版本分发的错误统一映射成 HTTP 状态。
func (h *AdminHandler) releaseError(c *gin.Context, err error, op string) {
	switch {
	case errors.Is(err, service.ErrReleaseNotFound):
		NotFound(c, "release not found")
	case errors.Is(err, service.ErrReleaseDuplicate):
		// 重复登记同一版是运营误操作，由唯一索引挡住，
		// 而不是产出两条互相覆盖的记录
		Error(c, http.StatusConflict, 409, "release already exists")
	case errors.Is(err, service.ErrReleaseRepoMissing):
		// 漏接线必须明说，不能静默把版本分发关掉 ——
		// 运营会以为发布成功了而实际什么都没发生
		Error(c, http.StatusServiceUnavailable, 503, "release repository not wired")
	default:
		h.logger.Error("admin "+op+" failed", zap.Error(err))
		InternalError(c, op+" failed")
	}
}
