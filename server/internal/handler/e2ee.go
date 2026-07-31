package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// 一次性预密钥单批上传上限，防止单请求写入过多。
const maxOneTimePreKeysPerUpload = 200

// E2EEHandler 端到端加密的公钥分发与密钥备份端点。
//
// 服务端职责边界：只中转公钥与客户端加密好的密文，
// 不持有任何可解密内容的私钥，也无法解密 backup blob（不知道用户 PIN）。
type E2EEHandler struct {
	repo   *repository.E2EERepository
	logger *zap.Logger
}

func NewE2EEHandler(repo *repository.E2EERepository, logger *zap.Logger) *E2EEHandler {
	return &E2EEHandler{repo: repo, logger: logger}
}

// UploadKeysBody 上传身份密钥 + signed prekey + 一次性预密钥。
type UploadKeysBody struct {
	IdentityDHPublicKey   string `json:"identity_dh_public_key" binding:"required,max=64"`
	IdentitySignPublicKey string `json:"identity_sign_public_key" binding:"required,max=64"`
	SignedPreKeyID        int    `json:"signed_prekey_id" binding:"required"`
	SignedPreKeyPublic    string `json:"signed_prekey_public" binding:"required,max=64"`
	SignedPreKeySignature string `json:"signed_prekey_signature" binding:"required,max=128"`
	OneTimePreKeys        []struct {
		KeyID     int    `json:"key_id" binding:"required"`
		PublicKey string `json:"public_key" binding:"required,max=64"`
	} `json:"one_time_prekeys" binding:"max=200"`
}

// UploadKeys 上传本机公钥材料。
//
//	@Summary		Upload E2EE public keys
//	@Tags			e2ee
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/e2ee/keys [post]
func (h *E2EEHandler) UploadKeys(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body UploadKeysBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if len(body.OneTimePreKeys) > maxOneTimePreKeysPerUpload {
		BadRequest(c, "too many one-time prekeys in one request")
		return
	}

	identity := &model.E2EEIdentity{
		UserID:                userID,
		IdentityDHPublicKey:   body.IdentityDHPublicKey,
		IdentitySignPublicKey: body.IdentitySignPublicKey,
		SignedPreKeyID:        body.SignedPreKeyID,
		SignedPreKeyPublic:    body.SignedPreKeyPublic,
		SignedPreKeySignature: body.SignedPreKeySignature,
	}
	if err := h.repo.UpsertIdentity(c.Request.Context(), identity); err != nil {
		h.logger.Error("upsert e2ee identity failed", zap.Error(err))
		InternalError(c, "upload keys failed")
		return
	}

	if len(body.OneTimePreKeys) > 0 {
		keys := make([]model.E2EEOneTimePreKey, 0, len(body.OneTimePreKeys))
		for _, k := range body.OneTimePreKeys {
			keys = append(keys, model.E2EEOneTimePreKey{
				UserID: userID, KeyID: k.KeyID, PublicKey: k.PublicKey,
			})
		}
		if err := h.repo.ReplaceOneTimePreKeys(c.Request.Context(), keys); err != nil {
			h.logger.Error("save one-time prekeys failed", zap.Error(err))
			InternalError(c, "upload prekeys failed")
			return
		}
	}

	remaining, _ := h.repo.CountOneTimePreKeys(c.Request.Context(), userID)
	Success(c, gin.H{"uploaded": true, "one_time_prekeys_remaining": remaining})
}

// PreKeyBundle 分发给发起方的公钥 bundle。
//
//	@Summary		Fetch a peer's prekey bundle
//	@Tags			e2ee
//	@Security		BearerAuth
//	@Param			userId	path	string	true	"peer user id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/e2ee/prekey-bundle/{userId} [get]
func (h *E2EEHandler) PreKeyBundle(c *gin.Context) {
	if _, ok := middleware.GetUserID(c); !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	peerID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}

	identity, err := h.repo.FindIdentity(c.Request.Context(), peerID)
	if err != nil {
		h.logger.Error("load e2ee identity failed", zap.Error(err))
		InternalError(c, "load bundle failed")
		return
	}
	if identity == nil {
		// 对方尚未启用 E2EE：客户端据此回退明文会话
		NotFound(c, "peer has not enabled e2ee")
		return
	}

	resp := gin.H{
		"identity_dh_public_key":   identity.IdentityDHPublicKey,
		"identity_sign_public_key": identity.IdentitySignPublicKey,
		"signed_prekey_id":         identity.SignedPreKeyID,
		"signed_prekey_public":     identity.SignedPreKeyPublic,
		"signed_prekey_signature":  identity.SignedPreKeySignature,
	}

	// 取一把一次性密钥（取后即删）；池空则省略，协商降级为 3DH
	otk, err := h.repo.PopOneTimePreKey(c.Request.Context(), peerID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		h.logger.Warn("pop one-time prekey failed", zap.Error(err))
	}
	if otk != nil {
		resp["one_time_prekey_id"] = otk.KeyID
		resp["one_time_prekey_public"] = otk.PublicKey
	}

	Success(c, resp)
}

// PreKeyCount 查询自己剩余的一次性预密钥数量（低于阈值时客户端补充）。
//
//	@Summary		Remaining one-time prekeys
//	@Tags			e2ee
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/e2ee/prekey-count [get]
func (h *E2EEHandler) PreKeyCount(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	count, err := h.repo.CountOneTimePreKeys(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("count prekeys failed", zap.Error(err))
		InternalError(c, "count failed")
		return
	}
	Success(c, gin.H{"remaining": count})
}

// SaveBackupBody 密钥备份（客户端已用 PIN 派生密钥加密）。
type SaveBackupBody struct {
	CipherBlob string `json:"cipher_blob" binding:"required"`
	Salt       string `json:"salt" binding:"required,max=64"`
	Version    int    `json:"version"`
}

// SaveBackup 保存密钥备份 blob。
//
//	@Summary		Save encrypted key backup
//	@Tags			e2ee
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/e2ee/backup [post]
func (h *E2EEHandler) SaveBackup(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body SaveBackupBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	version := body.Version
	if version <= 0 {
		version = 1
	}
	backup := &model.E2EEKeyBackup{
		UserID: userID, CipherBlob: body.CipherBlob, Salt: body.Salt, Version: version,
	}
	if err := h.repo.UpsertBackup(c.Request.Context(), backup); err != nil {
		h.logger.Error("save key backup failed", zap.Error(err))
		InternalError(c, "save backup failed")
		return
	}
	Success(c, gin.H{"saved": true, "version": version})
}

// GetBackup 取回密钥备份 blob（换设备恢复）。
//
//	@Summary		Fetch encrypted key backup
//	@Tags			e2ee
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/e2ee/backup [get]
func (h *E2EEHandler) GetBackup(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	backup, err := h.repo.FindBackup(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("load key backup failed", zap.Error(err))
		InternalError(c, "load backup failed")
		return
	}
	if backup == nil {
		Error(c, http.StatusNotFound, 404, "no backup found")
		return
	}
	Success(c, gin.H{
		"cipher_blob": backup.CipherBlob,
		"salt":        backup.Salt,
		"version":     backup.Version,
		"updated_at":  backup.UpdatedAt,
	})
}
