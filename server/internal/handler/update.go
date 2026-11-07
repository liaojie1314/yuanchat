package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// releaseURLTTL 安装包预签名下载 URL 的有效期。
//
// 比普通媒体的 2h 长：桌面端 updater 签完就下载，但安卓的「稍后更新」
// 可能隔几十分钟才真正点下载，TTL 太短会让用户点下载时拿到 403。
// 安装包不是隐私内容，放宽 TTL 的代价只是「URL 泄露后能多下几小时」。
const releaseURLTTL = 6 * time.Hour

// ReleasePresigner 检查安装包对象并签发预签名下载 URL，由 storage.Storage 实现。
//
// 抽成接口以便 handler 测试注入桩（对外端点不该在单测里真连 MinIO），
// 与 ObjectACL 同一种拆法。
//
// 实现必须走 storage 的 presignClient（绑定对外端点）而非内网 client 签完替 host ——
// SigV4 把 host 纳入签名，替换即失效。
type ReleasePresigner interface {
	PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error)
	ObjectExists(ctx context.Context, objectKey string) (bool, error)
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
//	@Param			bundle_type	query	string	false	"桌面安装器 deb / rpm / appimage / msi / nsis / app"
//	@Param			version		query	string	true	"客户端当前版本"
//	@Param			channel		query	string	false	"stable（默认）/ beta"
//	@Param			device		query	string	false	"设备标识，用于稳定灰度，优先于匿名桶"
//	@Param			X-YuanChat-Update-Cohort	header	int	false	"匿名灰度桶（0..99），仅无 device 时使用"
//	@Success		200	"桌面 static 清单；Android dynamic 更新体"
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

	resolve := h.svc.Resolve
	switch c.Param("platform") {
	case "linux", "windows", "darwin":
		resolve = h.svc.ResolveDesktop
	}
	res, err := resolve(c.Request.Context(),
		c.Param("platform"), c.Param("arch"),
		c.Query("channel"), c.Query("version"), deviceKey, cohort)
	if err != nil {
		// 自身故障必须是 5xx：updater 收到 204 会直接 return Ok(None) 而**不再**
		// 试下一个 endpoint，只有 5xx 才会落到 GitHub 兜底。
		h.logger.Error("resolve update failed", zap.Error(err))
		InternalError(c, "resolve failed")
		return
	}
	// 无更新 / 未中灰度 / 未知平台一律 204，明确阻止客户端继续询问备用源。
	if res == nil {
		c.Status(http.StatusNoContent)
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
	body := gin.H{
		"version":   res.Release.Version,
		"notes":     res.Release.Notes,
		"pub_date":  pubDate.Format(time.RFC3339),
		"mandatory": res.Mandatory,
	}
	if res.Platforms != nil {
		if bundle := c.Query("bundle_type"); bundle != "" {
			target := c.Param("platform") + "-" + c.Param("arch") + "-" + bundle
			variant, found := res.Platforms[target]
			if !found {
				// 已知安装器没有可用变体时明确返回 204，防止客户端重试绕过该格式灰度。
				c.Status(http.StatusNoContent)
				return
			}
			res.Platforms = map[string]model.AppRelease{target: variant}
		}
		platforms := make(map[string]gin.H, len(res.Platforms))
		for target, variant := range res.Platforms {
			if strings.TrimSpace(variant.ObjectKey) == "" || strings.TrimSpace(variant.Signature) == "" {
				h.logger.Error("incomplete updater variant", zap.String("release_id", variant.ID.String()))
				InternalError(c, "incomplete updater variant")
				return
			}
			// PresignGet 本身不访问对象；已放量对象缺失是故障，不能伪装成没有更新。
			exists, err := h.presigner.ObjectExists(c.Request.Context(), variant.ObjectKey)
			if err != nil || !exists {
				h.logger.Error("release object unavailable", zap.String("object_key", variant.ObjectKey), zap.Error(err))
				InternalError(c, "release object unavailable")
				return
			}
			url, err := h.presigner.PresignGet(c.Request.Context(), variant.ObjectKey, releaseURLTTL)
			if err != nil {
				h.logger.Error("presign release failed", zap.Error(err))
				InternalError(c, "presign failed")
				return
			}
			platforms[target] = gin.H{"url": url, "signature": variant.Signature}
		}
		// 只返回安装器精确键；通用键会让 deb/MSI 客户端误装 AppImage/NSIS。
		body["platforms"] = platforms
	} else {
		url, err := h.presigner.PresignGet(c.Request.Context(), res.Release.ObjectKey, releaseURLTTL)
		if err != nil {
			h.logger.Error("presign release failed", zap.Error(err))
			InternalError(c, "presign failed")
			return
		}
		body["url"] = url
		body["signature"] = res.Release.Signature
		body["sha256"] = res.Release.Sha256
		body["size"] = res.Release.Size
	}
	c.JSON(http.StatusOK, body)
}
