package service

import (
	"testing"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
)

// TestPreviewOf 会话列表预览的**文案本地化归属**：服务端只给类型标记（preview_kind），
// 具体文案由客户端按当前语言渲染。
//
// 原实现直接返回硬编码中文 `"[图片]"/"[表情]"`，而前端 WS 实时路径走 i18n.t()：
// 英/日/韩界面下同一条消息实时收到显示 "Sticker"、刷新后变 "[表情]"。
// 这里锁死"非文本类消息 preview 为空、kind 非空"，防止再有人把文案写回服务端。
func TestPreviewOf(t *testing.T) {
	cases := []struct {
		name        string
		msgType     int16
		content     string
		wantPreview string
		wantKind    string
	}{
		{"text", model.MessageTypeText, `{"text":"你好"}`, "你好", previewKindText},
		{"system", model.MessageTypeSystem, `{"text":"甲 创建了群聊"}`, "甲 创建了群聊", previewKindSystem},
		{"image", model.MessageTypeImage, `{"key":"images/x.png"}`, "", previewKindImage},
		{"file", model.MessageTypeFile, `{"key":"files/x.pdf"}`, "", previewKindFile},
		{"voice", model.MessageTypeVoice, `{"key":"voices/x.webm"}`, "", previewKindVoice},
		{"video", model.MessageTypeVideo, `{"key":"videos/x.mp4"}`, "", previewKindVideo},
		{"sticker", model.MessageTypeSticker, `{"sticker_id":"x"}`, "", previewKindSticker},
		{"e2ee", model.MessageTypeE2EE, `{"ciphertext":"zzz"}`, "", previewKindEncrypted},
		{"unknown", int16(99), `{}`, "", previewKindUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := &repository.MessageWithSender{}
			m.MessageType = tc.msgType
			m.Content = tc.content
			preview, kind := previewOf(m)
			if preview != tc.wantPreview {
				t.Fatalf("preview: want %q got %q", tc.wantPreview, preview)
			}
			if kind != tc.wantKind {
				t.Fatalf("kind: want %q got %q", tc.wantKind, kind)
			}
		})
	}
}

// TestPreviewOfNeverEmitsLocalizedText 兜底：任何类型的 preview 都不得含中括号占位文案。
// 这类字符串一旦回到服务端，多语言界面就会出现"实时一种语言、刷新另一种语言"。
func TestPreviewOfNeverEmitsLocalizedText(t *testing.T) {
	for _, mt := range []int16{
		model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice,
		model.MessageTypeVideo, model.MessageTypeSticker, model.MessageTypeE2EE,
	} {
		m := &repository.MessageWithSender{}
		m.MessageType = mt
		m.Content = `{"key":"k"}`
		if preview, _ := previewOf(m); preview != "" {
			t.Fatalf("type %d should not carry server-side placeholder text, got %q", mt, preview)
		}
	}
}
