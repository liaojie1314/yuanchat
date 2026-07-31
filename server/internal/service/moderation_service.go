package service

import (
	"strings"
	"sync"
)

// ModerationService 敏感词审核：命中词库的文本消息标记 flagged 进审核队列。
// 匹配为大小写不敏感的子串包含（词库量级小，线性扫描足够；
// 词库扩大到千级再换 Aho-Corasick）。
type ModerationService struct {
	mu    sync.RWMutex
	words []string // 已统一小写
}

func NewModerationService(words []string) *ModerationService {
	s := &ModerationService{}
	s.SetWords(words)
	return s
}

// SetWords 替换词库（供将来热更新用）。
func (s *ModerationService) SetWords(words []string) {
	normalized := make([]string, 0, len(words))
	for _, w := range words {
		if w = strings.TrimSpace(strings.ToLower(w)); w != "" {
			normalized = append(normalized, w)
		}
	}
	s.mu.Lock()
	s.words = normalized
	s.mu.Unlock()
}

// Check 返回文本命中的第一个敏感词；未命中返回空串。
func (s *ModerationService) Check(text string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, w := range s.words {
		if strings.Contains(lower, w) {
			return w
		}
	}
	return ""
}
