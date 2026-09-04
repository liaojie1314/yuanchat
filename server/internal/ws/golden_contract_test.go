package ws

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// goldenContract 是 contracts/message-send.golden.json 的结构。
//
// 前端（packages/shared/src/__tests__/messageSendGolden.test.ts）断言 messageStore
// 真的发出的 payload 与该文件一致；本测试把**同一份 JSON** 反序列化进 SendPayload
// 再跑 buildContent。两侧共用一份样本，任一端改字段名/类型/嵌套层级即双红。
type goldenContract struct {
	Cases []struct {
		Name                string `json:"name"`
		ExpectedMessageType int16  `json:"expected_message_type"`
		Frame               struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"frame"`
	} `json:"cases"`
}

// loadGolden 读取仓库根的契约文件（本包在 server/internal/ws，故上溯四级）。
func loadGolden(t *testing.T) goldenContract {
	t.Helper()
	path := filepath.Join("..", "..", "..", "contracts", "message-send.golden.json")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden contract: %v", err)
	}
	var g goldenContract
	if err := json.Unmarshal(blob, &g); err != nil {
		t.Fatalf("unmarshal golden contract: %v", err)
	}
	if len(g.Cases) == 0 {
		t.Fatal("golden contract has no cases")
	}
	return g
}

// TestGoldenMessageSendFrames 逐条验证黄金样本能被服务端接受，且落库类型正确。
func TestGoldenMessageSendFrames(t *testing.T) {
	g := loadGolden(t)

	for _, tc := range g.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			if tc.Frame.Type != TypeMessageSend {
				t.Fatalf("frame type = %q, want %q", tc.Frame.Type, TypeMessageSend)
			}

			var p SendPayload
			// DisallowUnknownFields：前端多发一个字段（或字段名拼错）时不再被静默忽略——
			// 那正是"契约漂移"最常见的形态（服务端读不到，前端以为发出去了）。
			dec := json.NewDecoder(bytes.NewReader(tc.Frame.Payload))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&p); err != nil {
				t.Fatalf("payload 不符合 SendPayload 契约: %v", err)
			}
			if p.ConversationID == uuid.Nil {
				t.Fatal("conversation_id 必须是合法非零 UUID")
			}

			c := newTestClient(uuid.Nil)
			mt, contentJSON, ok := new(Handler).buildContent(c, &p)
			if !ok {
				t.Fatalf("buildContent 拒绝了黄金样本: %s", decodeErr(t, c).Message)
			}
			assertNoFrame(t, c)
			if mt != tc.ExpectedMessageType {
				t.Fatalf("message_type = %d, want %d", mt, tc.ExpectedMessageType)
			}

			// 落库 content 必须是合法 JSON 对象（消息历史 REST 路径按对象解析）
			var stored map[string]any
			if err := json.Unmarshal([]byte(contentJSON), &stored); err != nil {
				t.Fatalf("落库 content 不是 JSON 对象: %v (%s)", err, contentJSON)
			}
			if len(stored) == 0 {
				t.Fatalf("落库 content 为空对象: %s", contentJSON)
			}
		})
	}
}

// TestGoldenCoversEveryContentType 黄金样本必须覆盖 buildContent 的全部分支。
//
// 新增一种 content type 却忘了加样本时本测试失败——否则该类型会重演贴纸那种
// "两端各自实现、谁都没验过同一份 JSON"的漂移。
func TestGoldenCoversEveryContentType(t *testing.T) {
	g := loadGolden(t)

	seen := map[string]bool{}
	for _, tc := range g.Cases {
		var probe struct {
			Content struct {
				Type string `json:"type"`
			} `json:"content"`
		}
		if err := json.Unmarshal(tc.Frame.Payload, &probe); err != nil {
			t.Fatalf("%s: %v", tc.Name, err)
		}
		seen[probe.Content.Type] = true
	}

	// buildContent 支持的全部 case
	for _, want := range []string{"text", "image", "file", "voice", "sticker", "video", "e2ee"} {
		if !seen[want] {
			t.Errorf("黄金样本缺少 content.type = %q 的用例", want)
		}
	}
}
