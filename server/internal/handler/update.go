package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// releaseURLTTL 安装包预签名下载 URL 的有效期。
//
// 比普通媒体的 2h 长：桌面端 updater 签完就下载，但安卓的「稍后更新」
// 可能隔几十分钟才真正点下载，TTL 太短会让用户点下载时拿到 403。
// 安装包不是隐私内容，放宽 TTL 的代价只是「URL 泄露后能多下几小时」。
const releaseURLTTL = 6 * time.Hour

// ReleasePresigner 为安装包对象键签发预签名下载 URL，由 storage.Storage 实现。
//
// 抽成接口以便 handler 测试注入桩（对外端点不该在单测里真连 MinIO），
// 与 ObjectACL 同一种拆法。
//
// 实现必须走 storage 的 presignClient（绑定对外端点）而非内网 client 签完替 host ——
// SigV4 把 host 纳入签名，替换即失效。
type ReleasePresigner interface {
	PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error)
}

// UpdateHandler 对外更新端点（免鉴权）。
//
// 免鉴权是刻意的：更新检查发生在登录之前也要能用 —— 一个因为 bug 登不进去的
// 版本，恰恰最需要收到更新。所以这里只暴露版本号与安装包 URL，不碰任何用户数据，
// 路由侧必须配 IP 限流。
type UpdateHandler struct {
	svc       *service.ReleaseService
	presigner ReleasePresigner
	logger    *zap.Logger
}

// NewUpdateHandler 构造对外更新端点处理器。
//
// p 为 nil（MinIO 不可达）时两个端点降级为 503，与 FileHandler 同一套策略。
// 刻意不降级成 204：204 会让 Tauri updater 直接认定「确定没有更新」从此不问
// 第二个 endpoint，而 5xx 才会让它落到 GitHub 兜底。
func NewUpdateHandler(svc *service.ReleaseService, p ReleasePresigner, logger *zap.Logger) *UpdateHandler {
	return &UpdateHandler{svc: svc, presigner: p, logger: logger}
}

// storageUnavailable 对象存储不可达时的统一降级响应。
func storageUnavailable(c *gin.Context) {
	Error(c, http.StatusServiceUnavailable, 503, "object storage unavailable")
}

// CatalogItem 下载页目录条目。
type CatalogItem struct {
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
	Size     int64  `json:"size"`
	Notes    string `json:"notes"`
	Sha256   string `json:"sha256,omitempty"`
	URL      string `json:"url"`
}

// Catalog 列出某渠道下每个平台/架构的最新已发布版本，供 Web 下载页用。
//
//	@Summary		下载目录
//	@Tags			updates
//	@Param			channel	query	string	false	"stable（默认）/ beta"
//	@Success		200	{object}	Response
//	@Router			/api/v1/updates/catalog [get]
func (h *UpdateHandler) Catalog(c *gin.Context) {
	if h.presigner == nil {
		storageUnavailable(c)
		return
	}
	rows, err := h.svc.CatalogLatest(c.Request.Context(), c.Query("channel"))
	if err != nil {
		h.logger.Error("release catalog failed", zap.Error(err))
		InternalError(c, "catalog failed")
		return
	}

	// 预先初始化成空切片而非 nil：nil 会序列化成 null，前端 .map 直接炸、
	// 空态也渲染不出来。
	items := make([]CatalogItem, 0, len(rows))
	for _, r := range rows {
		url, err := h.presigner.PresignGet(c.Request.Context(), r.ObjectKey, releaseURLTTL)
		if err != nil {
			// 单条签名失败只跳过该条，不让整页 500：下载页有三端五个包，
			// 一个对象缺失不该把其余四个也藏起来。
			h.logger.Warn("presign release failed, skip item",
				zap.String("object_key", r.ObjectKey), zap.Error(err))
			continue
		}
		items = append(items, CatalogItem{
			Platform: r.Platform,
			Arch:     r.Arch,
			Version:  r.Version,
			Size:     r.Size,
			Notes:    r.Notes,
			Sha256:   r.Sha256,
			URL:      url,
		})
	}
	Success(c, gin.H{"items": items})
}

// Check 返回 Tauri updater 期望的更新信息。
//
//	@Summary		检查更新
//	@Tags			updates
//	@Param			platform	path	string	true	"darwin / linux / windows / android"
//	@Param			arch		path	string	true	"x86_64 / aarch64 / universal / ..."
//	@Param			version		query	string	true	"客户端当前版本"
//	@Param			channel		query	string	false	"stable（默认）/ beta"
//	@Param			device		query	string	false	"设备标识，用于稳定灰度，优先于匿名桶"
//	@Param			X-YuanChat-Update-Cohort	header	int	false	"匿名灰度桶（0..99），仅无 device 时使用"
//	@Success		200	"扁平的 dynamic 格式更新体"
//	@Success		204	"无可用更新"
//	@Router			/api/v1/updates/{platform}/{arch} [get]
func (h *UpdateHandler) Check(c *gin.Context) {
	if h.presigner == nil {
		storageUnavailable(c)
		return
	}

	// 显式 device 优先；匿名桶只用于稳定放量，无效或缺失时沿用 IP 哈希。
	// 桶仅有 100 个值，不是设备唯一标识，也不能作为身份或权限凭据。
	deviceKey := c.Query("device")
	var cohort *int
	if deviceKey == "" {
		deviceKey = c.ClientIP()
		if bucket, err := strconv.ParseUint(c.GetHeader("X-YuanChat-Update-Cohort"), 10, 8); err == nil && bucket < 100 {
			value := int(bucket)
			cohort = &value
		}
	}

	res, err := h.svc.Resolve(c.Request.Context(),
		c.Param("platform"), c.Param("arch"),
		c.Query("channel"), c.Query("version"), deviceKey, cohort)
	if err != nil {
		// 自身故障必须是 5xx：updater 收到 204 会直接 return Ok(None) 而**不再**
		// 试下一个 endpoint，只有 5xx 才会落到 GitHub 兜底。
		h.logger.Error("resolve update failed", zap.Error(err))
		InternalError(c, "resolve failed")
		return
	}
	// 无更新 / 未中灰度 / 未知平台 一律 204 空体：
	// 返 200 带同版本号的话 updater 会当成有更新、把同一个包再装一遍。
	if res == nil {
		c.Status(http.StatusNoContent)
		return
	}

	url, err := h.presigner.PresignGet(c.Request.Context(), res.Release.ObjectKey, releaseURLTTL)
	if err != nil {
		h.logger.Error("presign release failed", zap.Error(err))
		InternalError(c, "presign failed")
		return
	}

	// pub_date 必须是 RFC3339：格式不对会让 updater **整个响应**反序列化失败，
	// 而不是丢掉这一个字段。published_at 理论上非 NULL（SetStatus 一并写），
	// 真为 NULL 时退回当前时刻 —— 宁可日期不准，也不能让更新检查整条失败。
	pubDate := time.Now().UTC()
	if res.Release.PublishedAt != nil {
		pubDate = res.Release.PublishedAt.UTC()
	}

	// 不走 Success() 包一层 {data:...}：tauri-plugin-updater 直接解析响应体
	// 根对象，包一层它读不到 version 字段。
	// 也**绝不能**带 platforms —— 该字段一出现 updater 就切到 static 格式解析。
	c.JSON(http.StatusOK, gin.H{
		"version":   res.Release.Version,
		"notes":     res.Release.Notes,
		"pub_date":  pubDate.Format(time.RFC3339),
		"url":       url,
		"signature": res.Release.Signature,
		"sha256":    res.Release.Sha256,
		"size":      res.Release.Size,
		"mandatory": res.Mandatory,
	})
}
