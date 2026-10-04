package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
)

// AdminStatsOverview 管理端运营概览聚合指标（只读快照，无分页）。
type AdminStatsOverview struct {
	// Users 用户维度：总数、封禁中、今日 / 近 7 天新增（按 created_at）
	Users AdminUserStats `json:"users"`
	// Conversations 会话总数
	Conversations AdminConversationStats `json:"conversations"`
	// Messages 消息维度：总数、今日新增、各类型计数（只统计未删除消息）
	Messages AdminMessageStats `json:"messages"`
	// Moderation 治理队列积压：待处理举报、敏感词命中消息、
	// 待处理 UGC 命中、已下架与打标表情包数
	Moderation AdminModerationStats `json:"moderation"`
	// Growth 增长侧写：好友申请量与验证码（OTP）下发量，今日 / 近 7 天
	Growth AdminGrowthStats `json:"growth"`
	// Runtime 运行时指标：本实例 WS 在线连接数由 handler 从 Hub 补齐
	Runtime AdminRuntimeStats `json:"runtime"`
}

// AdminUserStats 用户维度计数。
type AdminUserStats struct {
	Total    int64 `json:"total"`
	Banned   int64 `json:"banned"`
	NewToday int64 `json:"new_today"`
	NewWeek  int64 `json:"new_week"`
}

// AdminConversationStats 会话维度计数。
type AdminConversationStats struct {
	Total int64 `json:"total"`
}

// AdminMessageStats 消息维度计数。ByType 的键为类型名（text/image/file/voice/sticker 等）。
type AdminMessageStats struct {
	Total  int64            `json:"total"`
	Today  int64            `json:"today"`
	ByType map[string]int64 `json:"by_type"`
}

// AdminModerationStats 治理队列积压计数。
type AdminModerationStats struct {
	PendingReports  int64 `json:"pending_reports"`
	FlaggedMessages int64 `json:"flagged_messages"`
	PendingUGC      int64 `json:"pending_ugc"`
	TakenDownPacks  int64 `json:"taken_down_packs"`
	FlaggedPacks    int64 `json:"flagged_packs"`
}

// AdminGrowthStats 增长侧写计数。OTP 下发量按 verification_codes 审计表行数口径。
type AdminGrowthStats struct {
	FriendRequestsToday int64 `json:"friend_requests_today"`
	FriendRequestsWeek  int64 `json:"friend_requests_week"`
	OTPToday            int64 `json:"otp_today"`
	OTPWeek             int64 `json:"otp_week"`
}

// AdminRuntimeStats 运行时计数。OnlineConnections 由 handler 层从 ws.Hub 读取补齐。
type AdminRuntimeStats struct {
	OnlineConnections int64 `json:"online_connections"`
}

// messageTypeNames 消息类型数值 → 响应键名（未知类型聚合进 other）。
var messageTypeNames = map[int16]string{
	model.MessageTypeText:    "text",
	model.MessageTypeImage:   "image",
	model.MessageTypeFile:    "file",
	model.MessageTypeVoice:   "voice",
	model.MessageTypeVideo:   "video",
	model.MessageTypeSystem:  "system",
	model.MessageTypeE2EE:    "e2ee",
	model.MessageTypeSticker: "sticker",
}

// SetPushRepo 注入推送订阅仓库（装配层在启动前调用一次），概览的
// 订阅分页视图走它，与用户侧 push/subscribe 读写同一张表。
func (s *AdminService) SetPushRepo(repo *repository.PushRepository) {
	s.pushRepo = repo
}

// StatsOverview 聚合管理端概览指标。全部走 repo 层 COUNT / GROUP BY，
// 不取任何业务行数据；只读，不写审计日志。
func (s *AdminService) StatsOverview(ctx context.Context) (*AdminStatsOverview, error) {
	stats := &AdminStatsOverview{
		Messages: AdminMessageStats{ByType: map[string]int64{}},
	}

	total, banned, newToday, newWeek, err := s.repo.CountUserStats(ctx)
	if err != nil {
		return nil, err
	}
	stats.Users = AdminUserStats{Total: total, Banned: banned, NewToday: newToday, NewWeek: newWeek}

	if stats.Conversations.Total, err = s.repo.CountConversationStats(ctx); err != nil {
		return nil, err
	}

	msgTotal, msgToday, byType, flaggedMsgs, err := s.repo.CountMessageStats(ctx)
	if err != nil {
		return nil, err
	}
	stats.Messages.Total = msgTotal
	stats.Messages.Today = msgToday
	for code, count := range byType {
		name, ok := messageTypeNames[code]
		if !ok {
			name = "other"
		}
		stats.Messages.ByType[name] += count
	}

	pendingReports, pendingUGC, takenDown, flaggedPacks, err := s.repo.CountModerationStats(ctx)
	if err != nil {
		return nil, err
	}
	stats.Moderation = AdminModerationStats{
		PendingReports:  pendingReports,
		FlaggedMessages: flaggedMsgs,
		PendingUGC:      pendingUGC,
		TakenDownPacks:  takenDown,
		FlaggedPacks:    flaggedPacks,
	}

	frToday, frWeek, err := s.repo.CountFriendRequestStats(ctx)
	if err != nil {
		return nil, err
	}
	otpToday, otpWeek, err := s.repo.CountVerificationCodeStats(ctx)
	if err != nil {
		return nil, err
	}
	stats.Growth = AdminGrowthStats{
		FriendRequestsToday: frToday,
		FriendRequestsWeek:  frWeek,
		OTPToday:            otpToday,
		OTPWeek:             otpWeek,
	}

	return stats, nil
}

// SearchPushSubscriptions 分页检索推送订阅（最新在前，附用户昵称）。
// pushRepo 未注入时按空仓库处理，返回空页而非报错。
func (s *AdminService) SearchPushSubscriptions(ctx context.Context, page, size int) ([]repository.AdminPushSubscription, int64, error) {
	if s.pushRepo == nil {
		return nil, 0, nil
	}
	return s.pushRepo.ListAll(ctx, (page-1)*size, size)
}

// ErrInvalidStatsDays days 参数越界时返回此哨兵错误，
// 调用方可据此返回 HTTP 400（不静默夹取，防止调用方拿到与请求不符的区间）。
var ErrInvalidStatsDays = errors.New("days must be between 7 and 90")

// StatsTimeseries 返回最近 days（7–90）天的逐日数据序列。
// 空日在 repo 层补零，调用方拿到的序列长度恒为 days、日期升序连续。
// 只读端点，不写审计日志。
func (s *AdminService) StatsTimeseries(ctx context.Context, days int) (*StatsTimeseriesResult, error) {
	if days < 7 || days > 90 {
		return nil, ErrInvalidStatsDays
	}
	pts, err := s.repo.CountTimeseries(ctx, days)
	if err != nil {
		return nil, fmt.Errorf("timeseries: %w", err)
	}
	return &StatsTimeseriesResult{Days: days, Points: pts}, nil
}

// StatsTimeseriesResult 时间序列响应体。
type StatsTimeseriesResult struct {
	// Days 请求的窗口天数（与请求参数一致，方便前端校验）
	Days int `json:"days"`
	// Points 逐日数据点，长度恒等于 Days，日期升序（最旧在前）
	Points []repository.TimeseriesPoint `json:"points"`
}
