package handler

import (
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/storage"
	"go.uber.org/zap"
)

const (
	// uploadURLTTL 预签名上传 URL 有效期：15 分钟，够客户端完成一次直传。
	uploadURLTTL = 15 * time.Minute
	// downloadURLTTL 预签名下载 URL 有效期：24 小时，覆盖消息/图片的常规浏览窗口。
	downloadURLTTL = 24 * time.Hour
)

// objectKeyPattern 约束合法对象键，形如 images/2026/07/<uuid>.png。
// download-url 用它拦截任意 key 探测：仅允许受控前缀 + 年月分区 + uuid + 小写扩展名。
// 必须与 buildObjectKey 生成的键自洽（上传签发的 key 必然能通过下载校验）。
var objectKeyPattern = regexp.MustCompile(`^(images|avatars|files)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`)

// FileHandler 文件直传端点：签发预签名上传/下载 URL，服务端不中转文件字节。
// st 可能为 nil（MinIO 不可达时），相关端点据此降级为 503。
type FileHandler struct {
	st     *storage.Storage
	cfg    config.UploadConfig
	logger *zap.Logger
}

// NewFileHandler 构造文件端点处理器。cfg 提供白名单与大小上限，st 为 nil 时端点返回 503。
func NewFileHandler(st *storage.Storage, cfg config.UploadConfig, logger *zap.Logger) *FileHandler {
	return &FileHandler{st: st, cfg: cfg, logger: logger}
}

// uploadURLRequest 上传签名请求体。
// content_type 不设 binding 必填：留空时由白名单校验统一回 4001，语义更准。
type uploadURLRequest struct {
	Filename    string `json:"filename" binding:"required"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

// UploadURL 校验文件类型/大小后签发预签名上传 URL，客户端凭此 PUT 直传对象存储。
//
//	@Summary		Presign an upload URL
//	@Tags			files
//	@Security		BearerAuth
//	@Param			category	query	string	false	"目标类别，显式指定 avatars 走公共读；默认按 content_type 推断"
//	@Success		200	{object}	Response
//	@Failure		400	{object}	Response	"4001 unsupported file type / 4002 file too large"
//	@Failure		503	{object}	Response	"object storage unavailable"
//	@Router			/api/v1/files/upload-url [post]
func (h *FileHandler) UploadURL(c *gin.Context) {
	var req uploadURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	// 1. 类型白名单：非白名单（含空串）→ 4001。
	if !slices.Contains(h.cfg.AllowedTypes, req.ContentType) {
		Error(c, http.StatusBadRequest, 4001, "unsupported file type")
		return
	}
	// 2. 大小上限：超过 max_file_size → 4002。
	if req.Size > h.cfg.MaxFileSize {
		Error(c, http.StatusBadRequest, 4002, "file too large")
		return
	}

	category := resolveCategory(req.ContentType, c.Query("category"))
	objectKey := buildObjectKey(category, req.Filename)
	// 3. 键自洽校验：文件名扩展名脏（含空格/缺失/非小写字母数字）会生成 download-url 拒收的键，
	//    导致对象上传后永久取不回。此处提前拦成 4001，与类型白名单同族，保证上传签发的键必可下载。
	//    属客户端输入错误，故置于存储可用性检查之前，与 4002 一同归为请求校验。
	if !objectKeyPattern.MatchString(objectKey) {
		Error(c, http.StatusBadRequest, 4001, "invalid file extension")
		return
	}
	// 4. 存储不可达 → 降级 503。
	if h.st == nil {
		Error(c, http.StatusServiceUnavailable, 503, "object storage unavailable")
		return
	}

	uploadURL, err := h.st.PresignPut(c.Request.Context(), objectKey, req.ContentType, uploadURLTTL)
	if err != nil {
		h.logger.Error("presign put failed", zap.String("object_key", objectKey), zap.Error(err))
		InternalError(c, "failed to sign upload url")
		return
	}

	data := gin.H{
		"upload_url": uploadURL,
		"object_key": objectKey,
		"expires_in": int(uploadURLTTL.Seconds()),
	}
	// 头像走匿名公共读，直接返回 PublicURL，前端无需再签下载。
	if category == "avatars" {
		data["public_url"] = h.st.PublicURL(objectKey)
	}
	Success(c, data)
}

// DownloadURL 校验对象键后签发预签名下载 URL，用于私有对象（图片消息等）的受控读取。
//
//	@Summary		Presign a download URL
//	@Tags			files
//	@Security		BearerAuth
//	@Param			key	query	string	true	"对象键，须匹配 {category}/{yyyy}/{mm}/{uuid}.{ext}"
//	@Success		200	{object}	Response
//	@Failure		400	{object}	Response	"invalid object key"
//	@Failure		503	{object}	Response	"object storage unavailable"
//	@Router			/api/v1/files/download-url [get]
func (h *FileHandler) DownloadURL(c *gin.Context) {
	key := c.Query("key")
	// 先做正则校验，拦截任意 key 探测（越权拉取未授权对象）。
	if !objectKeyPattern.MatchString(key) {
		BadRequest(c, "invalid object key")
		return
	}
	if h.st == nil {
		Error(c, http.StatusServiceUnavailable, 503, "object storage unavailable")
		return
	}

	downloadURL, err := h.st.PresignGet(c.Request.Context(), key, downloadURLTTL)
	if err != nil {
		h.logger.Error("presign get failed", zap.String("object_key", key), zap.Error(err))
		InternalError(c, "failed to sign download url")
		return
	}

	Success(c, gin.H{
		"url":        downloadURL,
		"expires_in": int(downloadURLTTL.Seconds()),
	})
}

// resolveCategory 决定对象存储的一级前缀（类别）。
// 显式 query 优先：命中白名单直接采用，非法值回落 files；
// 无 query 时按 content_type 推断（image/* → images，其余 → files）。
// 头像不参与推断，须由前端显式 ?category=avatars 指定，以走匿名公共读。
func resolveCategory(contentType, query string) string {
	if query != "" {
		switch query {
		case "images", "avatars", "files":
			return query
		default:
			return "files"
		}
	}
	if strings.HasPrefix(contentType, "image/") {
		return "images"
	}
	return "files"
}

// buildObjectKey 生成对象键：{category}/{yyyy/mm}/{uuid}{ext}。
// 按年月分区避免单前缀对象过多；uuid 防碰撞并隐藏原始文件名；扩展名统一小写以匹配下载正则。
func buildObjectKey(category, filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	return category + "/" + time.Now().Format("2006/01") + "/" + uuid.NewString() + ext
}
