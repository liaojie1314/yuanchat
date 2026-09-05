package ws

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// serverFrameGolden 是 contracts/server-frames.golden.json 的顶层结构。
type serverFrameGolden struct {
	Cases []struct {
		Name  string `json:"name"`
		Frame struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"frame"`
	} `json:"cases"`
}

func loadServerFrameGolden(t *testing.T) serverFrameGolden {
	t.Helper()
	// 上溯四级到仓库根：internal/ws → internal → server → 仓库根
	path := filepath.Join("..", "..", "..", "contracts", "server-frames.golden.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var g serverFrameGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("unmarshal golden: %v", err)
	}
	return g
}

// TestGoldenServerFramesDecodeIntoPayloadStructs 逐个 case 把契约 payload
// 以 DisallowUnknownFields 反序列化进对应 struct：既证明 struct 能完整表达
// 契约，也挡下契约里出现 struct 未声明的字段（双向钉死）。
func TestGoldenServerFramesDecodeIntoPayloadStructs(t *testing.T) {
	g := loadServerFrameGolden(t)
	if len(g.Cases) == 0 {
		t.Fatal("golden 没有任何用例")
	}

	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			dec := json.NewDecoder(bytes.NewReader(c.Frame.Payload))
			dec.DisallowUnknownFields()

			switch c.Frame.Type {
			case TypeMessageEdited:
				var p MessageEditedPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MessageEditedPayload: %v", err)
				}
				if p.Text == "" {
					t.Error("Text 为空，契约样本应带正文")
				}
				if p.EditCount == 0 {
					t.Error("EditCount 为 0，契约样本应 ≥1")
				}
			case TypeMessageRecalled:
				var p MessageRecalledPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MessageRecalledPayload: %v", err)
				}
				if p.OperatorNickname == "" {
					t.Error("OperatorNickname 为空，契约样本应带昵称")
				}
			default:
				t.Fatalf("契约含未知帧类型 %q —— 新增帧须同时在本 switch 注册", c.Frame.Type)
			}
		})
	}
}

// TestGoldenServerFramesRoundTripThroughEncode 证明 Encode 产出的信封
// 与契约声明的 type 一致（Envelope 双层序列化不会改写 type）。
func TestGoldenServerFramesRoundTripThroughEncode(t *testing.T) {
	g := loadServerFrameGolden(t)
	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			frame, err := Encode(c.Frame.Type, json.RawMessage(c.Frame.Payload))
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			var env struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(frame, &env); err != nil {
				t.Fatalf("unmarshal envelope: %v", err)
			}
			if env.Type != c.Frame.Type {
				t.Errorf("envelope type = %q, want %q", env.Type, c.Frame.Type)
			}
		})
	}
}
