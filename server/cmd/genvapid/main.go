// genvapid 生成 Web Push 所需的 VAPID 密钥对。
//
// 用法：
//
//	go run ./cmd/genvapid
//
// 输出的两行分别填入 config.yaml 的 push.vapid_private_key /
// push.vapid_public_key（或对应环境变量）。公钥同时会下发给前端用于
// pushManager.subscribe，私钥务必保密。
package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalf("generate VAPID keys: %v", err)
	}
	fmt.Println("push:")
	fmt.Printf("  vapid_public_key: %q\n", publicKey)
	fmt.Printf("  vapid_private_key: %q\n", privateKey)
}
