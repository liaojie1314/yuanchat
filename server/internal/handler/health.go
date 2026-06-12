package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// HealthHandler 健康检查处理器
type HealthHandler struct{}

// NewHealthHandler 创建健康检查处理器
func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// Check 健康检查接口
//
//	@Summary		健康检查
//	@Description	检查服务是否正常运行
//	@Tags			system
//	@Produce		json
//	@Success		200	{object}	Response	"服务正常"
//	@Router			/api/v1/health [get]
func (h *HealthHandler) Check(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "yuanchat-server",
	})
}
