package ws

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
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
// 以 DisallowUnknownFields 反序列化进对应 struct，挡下契约里出现 struct
// 未声明的字段（契约 ⊆ struct 这一个方向）。
//
// 反方向（struct 有字段而契约漏了它）由 TestGoldenServerFramesFieldSetsMatch 覆盖 ——
// 单靠本测试挡不住：JSON 缺字段只会留零值，解码照样成功。
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
			case TypeMessageRecalled:
				var p MessageRecalledPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MessageRecalledPayload: %v", err)
				}
			case TypeCallIncoming:
				var p CallIncomingPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into CallIncomingPayload: %v", err)
				}
			case TypeCallState:
				var p CallStatePayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into CallStatePayload: %v", err)
				}
			case TypeCallSignal:
				var p CallSignalPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into CallSignalPayload: %v", err)
				}
			case TypeCallEnded:
				var p CallEndedPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into CallEndedPayload: %v", err)
				}
			case TypeMomentsActivity:
				var p MomentsActivityPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MomentsActivityPayload: %v", err)
				}
			default:
				t.Fatalf("契约含未知帧类型 %q —— 新增帧须同时在本 switch 注册", c.Frame.Type)
			}
		})
	}
}

// payloadPrototypes 给每个帧类型一个零值 payload，供字段集比对用反射取 json tag。
// 新增服务端帧必须在这里登记，否则 TestGoldenServerFramesFieldSetsMatch 会失败。
func payloadPrototypes() map[string]any {
	return map[string]any{
		TypeMessageEdited:   MessageEditedPayload{},
		TypeMessageRecalled: MessageRecalledPayload{},
		TypeCallIncoming:    CallIncomingPayload{},
		TypeCallState:       CallStatePayload{},
		TypeCallSignal:      CallSignalPayload{},
		TypeCallEnded:       CallEndedPayload{},
		TypeMomentsActivity: MomentsActivityPayload{},
	}
}

// jsonFieldNames 反射取出 struct 的全部 json 字段名（忽略 "-" 与 omitempty 后缀）。
func jsonFieldNames(v any) map[string]bool {
	out := map[string]bool{}
	rt := reflect.TypeOf(v)
	for i := 0; i < rt.NumField(); i++ {
		tag := rt.Field(i).Tag.Get("json")
		if tag == "" || tag == "-" {
			continue
		}
		if comma := strings.Index(tag, ","); comma >= 0 {
			tag = tag[:comma]
		}
		if tag != "" {
			out[tag] = true
		}
	}
	return out
}

// TestGoldenServerFramesFieldSetsMatch 断言契约样本的字段集与 payload struct 的
// json 字段集**完全相等**，双向钉死契约与代码。
//
// 为什么必须单列一个测试：DisallowUnknownFields 只拦「契约多了字段」；
// 若给 struct 加了字段而忘记更新契约，或从契约里删掉某字段，解码都照样成功
// （缺字段只留零值），漂移就悄悄溜过去了。而契约文件是双端唯一真源，
// 「漂移即双红」是它存在的全部理由。
func TestGoldenServerFramesFieldSetsMatch(t *testing.T) {
	g := loadServerFrameGolden(t)
	protos := payloadPrototypes()

	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			proto, ok := protos[c.Frame.Type]
			if !ok {
				t.Fatalf("帧类型 %q 未在 payloadPrototypes 登记", c.Frame.Type)
			}

			var raw map[string]json.RawMessage
			if err := json.Unmarshal(c.Frame.Payload, &raw); err != nil {
				t.Fatalf("unmarshal payload: %v", err)
			}

			want := jsonFieldNames(proto)
			for name := range want {
				if _, present := raw[name]; !present {
					t.Errorf("契约样本缺字段 %q（struct 有，契约无 —— 服务端会下发它但契约没声明）", name)
				}
			}
			for name := range raw {
				if !want[name] {
					t.Errorf("契约样本多字段 %q（契约有，struct 无）", name)
				}
			}
		})
	}
}

// TestGoldenServerFramesEnvelopeTypePreserved 证明 Encode 的双层序列化不改写
// 信封的 type 字段。
//
// 注意它**不**验证 payload 的序列化形状：契约字节是当 json.RawMessage 原样
// 透传给 Encode 的，根本没经过 payload struct。形状一致性由上面两个测试负责。
func TestGoldenServerFramesEnvelopeTypePreserved(t *testing.T) {
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
